// Real accounts: their settings and passwords, one AccountSync each, and the
// bridge to the app's state. The app's changes arrive as "messages before and
// after" (Mail's onChange) and become server changes here; the servers'
// messages arrive through Mail.receive.
import { createSignal, notify, win } from "mantou-ui";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SAMPLE_ACCOUNTS, longDate, now, recipients, sampleMessages, type Attachment, type Folder, type Message } from "../data";
import { Blobs } from "./blobs";
import type { MessageOptions } from "mantou-ui";
import { confirm, downloadsDir, freeName, openWithSystem, pickFiles, pickSavePath, typeOf } from "./files";
import type { Mail, Mailbox } from "../state";
import { AccountSync, checkLogin, oneCopy, type Login, type SyncStatus } from "./imap";
import { guessSmtp, savesSent, type ImapSettings, type SmtpSettings } from "./providers";
import { OAuthError, appProviders, hostOfMx, oauthFor, refresh, signIn, type OAuthProvider, type OAuthProviderId, type Providers, type Tokens } from "./oauth";
import { resolveMx } from "node:dns/promises";
import { checkSmtp, compose, send as sendSmtp } from "./smtp";
import type { Secrets } from "./secrets";
import type { AccountConfig, Store } from "./store";

/** How long a message waits in the outbox before it's sent: Undo Send takes it back meanwhile. */
export const UNDO_SEND_MS = 10_000;

export interface NewAccount {
  email: string;
  /** Its password, or (signed in with a provider) its tokens. */
  password?: string;
  oauth?: { provider: OAuthProviderId; tokens: Tokens & { refreshToken: string } };
  imap: ImapSettings;
  /** Where mail is sent (default: guessed from the address). */
  smtp?: SmtpSettings;
  /** The sender name for mail from it (default: the part of the address before the @). */
  sender?: string;
}

export class Remote {
  private syncs = new Map<string, AccountSync>();
  readonly blobs: Blobs;
  /** Messages in the outbox, by id: their send timers. */
  private outbox = new Map<number, ReturnType<typeof setTimeout>>();
  private mail: Mail | null = null;
  private lastId: number;
  private readonly statusSignal = createSignal<Record<string, SyncStatus>>({});
  private readonly listSignal = createSignal<AccountConfig[]>([]);
  private readonly olderSignal = createSignal<Record<string, number>>({});
  /** The real accounts, as a signal (accounts() reads the store). */
  readonly list = this.listSignal[0];
  /** Each account's sync status, by account id. */
  readonly statuses = this.statusSignal[0];

  constructor(readonly store: Store, readonly secrets: Secrets, private options: {
      expungeDelay?: number;
      window?: number;
      /** The first wait before an account connects again (default 2 s). */
      retry?: number;
      undoSend?: number;
      /** Where attachments' bytes are kept (default: a folder in the system's temp folder). */
      blobs?: Blobs;
      /** Where opened attachments are saved (default: Downloads), and what opens them (default: the system). */
      downloads?: string;
      open?: (path: string) => void;
      /** Shows a notification for new mail (default: the system's), and whether the app's window has the focus (default: asks the window; a focused app doesn't notify). */
      notify?: (n: { title: string; body: string }) => void;
      focused?: () => Promise<boolean>;
      /** The providers accounts can sign in with (default: the app's, see oauth.ts), and what opens their sign-in page (default: the system's browser). */
      oauth?: Providers;
      /** A domain's MX hosts (default: DNS), to tell a company on Google Workspace or Microsoft 365. */
      mx?: (domain: string) => Promise<string[]>;
      openUrl?: (url: string) => void | Promise<void>;
    } = {},) {
    this.lastId = store.maxId();
    this.blobs = options.blobs ?? new Blobs(join(tmpdir(), "mantou-mail-attachments"));
    this.listSignal[1](store.accounts());
  }

  accounts(): AccountConfig[] {
    return this.store.accounts();
  }

  /** What the app starts with: the saved mail of real accounts, or the sample mail when there are none. */
  initial(): { messages: Message[]; accounts: AccountConfig[] | typeof SAMPLE_ACCOUNTS } {
    const accounts = this.accounts();
    return accounts.length ? { messages: oneCopy(this.store.messages()), accounts } : { messages: sampleMessages(), accounts: SAMPLE_ACCOUNTS };
  }

  private setStatus(id: string, s: SyncStatus) {
    this.statusSignal[1]({ ...this.statuses(), [id]: s });
  }

  /** Connects the app's state, and starts syncing every account (one without its password or sign-in says so). */
  async attach(mail: Mail) {
    this.mail = mail;
    for (const a of this.accounts()) {
      if (await this.secrets.get(a.id)) this.start(a);
      else this.setStatus(a.id, { state: "needs-password", detail: a.oauth ? `Sign in to ${a.email} again to sync it` : `Enter the password for ${a.email} to sync it` });
    }
    // What was in the outbox when the app last stopped goes now.
    for (const m of mail.messages()) if (m.outbox && this.isReal(m.account)) this.queueSend(m, 0); // and scheduled ones at their time
  }

  private isReal(account: string) {
    return this.store.accounts().some((x) => x.id === account);
  }

  /**
   * Puts a message in the outbox: it goes after the Undo Send delay, or at its
   * Send Later time (by the app's clock, so tests can fix it), or now if that's past.
   */
  private queueSend(m: Message, delay = this.options.undoSend ?? UNDO_SEND_MS) {
    if (this.outbox.has(m.id)) return;
    const at = m.outbox?.at ? Date.parse(m.outbox.at) : now().getTime() + delay;
    // setTimeout holds at most about 24.8 days; a later time waits in steps.
    const wait = () => {
      const left = at - now().getTime();
      this.outbox.set(m.id, setTimeout(() => {
        if (at - now().getTime() > 1_000) return wait();
        this.outbox.delete(m.id);
        void this.deliver(m.id);
      }, Math.max(0, Math.min(left, 2 ** 31 - 1))));
    };
    wait();
  }

  private cancelSend(id: number) {
    clearTimeout(this.outbox.get(id));
    this.outbox.delete(id);
  }

  /** Sends a message from the outbox over SMTP, then files it in Sent. On failure it goes back to Drafts, with the reason. */
  private async deliver(id: number) {
    const mail = this.mail;
    const m = mail?.messages().find((x) => x.id === id);
    if (!mail || !m?.outbox || (m.folder !== "sent" && m.folder !== "scheduled")) return;
    const late = m.outbox.at && now().getTime() - Date.parse(m.outbox.at) > 60_000 ? m.outbox.at : undefined;
    const cfg = this.accounts().find((a) => a.id === m.account);
    let login: Login | null = null;
    let why = "the account's password is needed";
    try {
      login = cfg ? await this.loginOf(cfg) : null;
      if (cfg?.oauth && !login) why = `sign in to ${cfg.email} again`;
    } catch (e) {
      why = (e as Error).message;
    }
    const names = recipients(m).map((c) => c.name).join(", ");
    const fail = (why: string) => {
      mail.backToDrafts(id);
      this.store.put(mail.messages().filter((x) => x.id === id));
      mail.note(`Couldn't send “${m.subject}”: ${why}. It's in Drafts.`);
    };
    if (!cfg || !login) return fail(why);
    const smtp = cfg.smtp ?? { ...guessSmtp(cfg.email), user: cfg.imap.user };
    const original = m.outbox.replyTo === undefined ? undefined : mail.messages().find((x) => x.id === m.outbox!.replyTo);
    let raw: Buffer;
    let sentCopy: Buffer;
    try {
      const files = await Promise.all((m.attachments ?? []).map(async (a) => ({ name: a.name, type: a.type, content: await this.bytesOf(a) })));
      const out = { ...m, date: now() };
      raw = await compose(out, original, files, { signature: cfg.signature });
      // The copy filed in Sent keeps the Bcc line, so you can see who got it.
      sentCopy = m.bcc?.length ? await compose(out, original, files, { keepBcc: true, signature: cfg.signature }) : raw;
      await sendSmtp(smtp, login, m, raw);
    } catch (e) {
      return fail((e as Error).message);
    }
    mail.patchQuiet(id, { outbox: undefined, folder: "sent", date: now() });
    this.store.put(mail.messages().filter((x) => x.id === id));
    mail.note(late ? `Sent to ${names}: it was scheduled for ${longDate(new Date(late))}, while the app wasn't running` : `Sent to ${names}`);
    await this.syncs.get(cfg.id)?.fileSent(sentCopy, !savesSent(smtp.host)).catch(() => {});
  }

  /** Per draft (by Message-ID): its server copy's latest change, so that they happen in the order they were made. */
  private mirrors = new Map<string, Promise<void>>();

  /** The newest inbox message's date, per account, when its mail was last handed to the app: what's newer than it is new mail. */
  private newest = new Map<string, number>();

  /** Tells of mail that came in since the last time, unless the window has the focus. The first look at an account only notes where it stands. */
  private announceNew(account: string, list: Message[]) {
    const inbox = list.filter((m) => m.folder === "inbox");
    const was = this.newest.get(account);
    this.newest.set(account, Math.max(was ?? 0, ...inbox.map((m) => m.date.getTime())));
    const fresh = was === undefined ? [] : inbox.filter((m) => m.unread && m.date.getTime() > was);
    if (!fresh.length) return;
    void (async () => {
      try {
        if (await (this.options.focused ?? (async () => !!(await win.state())?.focused))()) return;
        const one = fresh.length === 1;
        (this.options.notify ?? ((n) => void notify(n)))({
          title: one ? fresh[0].from.name : `${fresh.length} new messages`,
          body: one ? fresh[0].subject || "(no subject)" : fresh.slice(0, 3).map((m) => m.from.name).join(", "),
        });
      } catch {} // no window to ask (tests, or before it opens)
    })();
  }

  /** Puts a draft's current text in the server's Drafts in place of its earlier copy, or (no `draft`) removes the copy. Best effort: a later save tries again. */
  private mirrorDraft(account: string, messageId: string, draft?: Message) {
    const run = async () => {
      try {
        let raw: Buffer | undefined;
        if (draft) {
          const original = draft.draft?.replyTo === undefined ? undefined : this.mail?.messages().find((x) => x.id === draft.draft!.replyTo);
          const files = await Promise.all((draft.attachments ?? []).map(async (a) => ({ name: a.name, type: a.type, content: await this.bytesOf(a) })));
          raw = await compose(draft, original, files, { keepBcc: true });
        }
        await this.syncs.get(account)?.mirrorDraft(messageId, raw);
      } catch {}
    };
    const next = (this.mirrors.get(messageId) ?? Promise.resolve()).then(run);
    this.mirrors.set(messageId, next);
    void next.then(() => this.mirrors.get(messageId) === next && this.mirrors.delete(messageId));
  }

  // ------------------------------------------------------------ attachments

  /**
   * An attachment's bytes: sample mail's text, the blob store, or the server
   * (downloaded once, then kept in the blob store, so it opens offline next time).
   * `message` is the one it's on, if not `a.from` (forwarded).
   */
  async bytesOf(a: Attachment, message?: Message): Promise<Uint8Array> {
    if (a.text !== undefined) return new TextEncoder().encode(a.text);
    if (a.blob && (await this.blobs.has(a.blob))) return this.blobs.get(a.blob);
    const on = message ?? this.mail?.messages().find((m) => m.id === a.from);
    const sync = on && this.syncs.get(on.account);
    if (!on || !a.part || !sync) throw new Error(`“${a.name}” isn't here, and its message isn't on a server this app can reach`);
    const bytes = await sync.download(on.id, a.part);
    const blob = await this.blobs.put(bytes);
    // Remember where the bytes are now, on the message they came with.
    const cur = this.mail?.messages().find((m) => m.id === on.id);
    if (cur?.attachments) {
      const attachments = cur.attachments.map((x) => (x.part === a.part && x.name === a.name ? { ...x, blob } : x));
      this.mail?.patchQuiet(cur.id, { attachments });
      if (cur.remote || this.isReal(cur.account)) this.store.put(this.mail!.messages().filter((m) => m.id === cur.id));
    }
    return bytes;
  }

  /** Saves an attachment in Downloads and opens it with the system's app; resolves to where it went. */
  async openAttachment(message: Message, a: Attachment): Promise<string> {
    const bytes = await this.bytesOf(a, message);
    const path = freeName(this.options.downloads ?? downloadsDir(), a.name);
    await Bun.write(path, bytes);
    (this.options.open ?? openWithSystem)(path);
    return path;
  }

  /** Saves an attachment where the person chooses (Downloads when there's no dialog); resolves to the path, or null if they cancelled. */
  async saveAttachment(message: Message, a: Attachment): Promise<string | null> {
    const path = await this.pickSavePath(this.options.downloads ?? downloadsDir(), a.name);
    if (!path) return null;
    await Bun.write(path, await this.bytesOf(a, message));
    return path;
  }

  /** Files from this computer as attachments: their bytes go to the blob store, so the draft doesn't depend on them staying put. */
  async attachFiles(paths: string[]): Promise<Attachment[]> {
    return Promise.all(paths.map(async (path) => {
      const file = Bun.file(path);
      if (!(await file.exists())) throw new Error(`There's no file at ${path}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return { name: basename(path), type: typeOf(path), size: bytes.length, blob: await this.blobs.put(bytes) };
    }));
  }

  /** The system's file dialog (null where there's none: the composer then asks for a path). */
  pickFiles = () => pickFiles();
  /** The system's save dialog (a free name in Downloads where there's none). */
  pickSavePath = (dir: string, name: string) => pickSavePath(dir, name);
  /** The system's message box, for a yes or no (yes where there's none). */
  confirm = (options: MessageOptions) => confirm(options);

  /** Waits for the outbox to empty (tests). */
  async outboxEmpty() {
    while (this.outbox.size || this.mail?.messages().some((m) => m.outbox && this.isReal(m.account))) await Bun.sleep(5);
  }

  newId = () => {
    this.lastId = Math.max(this.lastId, ...(this.mail?.messages().map((m) => m.id) ?? [0])) + 1;
    return this.lastId;
  };

  // ------------------------------------------------------------ logging in

  /** Access tokens of accounts that sign in with a provider, by account id (in memory only). */
  private tokens = new Map<string, Tokens>();

  private providers(): Providers {
    return this.options.oauth ?? appProviders();
  }
  /** Opens a web page in the system's browser (a provider's app password page). */
  openLink(url: string) {
    void (this.options.openUrl ?? openWithSystem)(url);
  }

  /** Who hosts each domain's mail, by its MX records, once looked up (hostedBy). */
  private hosts = new Map<string, OAuthProviderId | null>();
  private readonly hostsSignal = createSignal(0);
  /** The provider an account signs in with, configured or guessed from its address (null: it uses a password). */
  providerOf(account: { oauth?: OAuthProviderId; email: string }): OAuthProvider | null {
    if (account.oauth) return this.providers()[account.oauth] ?? null;
    this.hostsSignal[0](); // a lookup that finishes later changes the answer
    const domain = account.email.trim().toLowerCase().split("@")[1] ?? "";
    return oauthFor(account.email, this.providers(), this.hosts.get(domain) ?? undefined);
  }
  /**
   * Looks up who hosts an address's mail (its domain's MX records), so a
   * company address on Google Workspace or Microsoft 365 signs in too.
   * providerOf follows when it's done; failures count as "no one".
   */
  async lookUpHost(email: string): Promise<OAuthProviderId | null> {
    const domain = email.trim().toLowerCase().split("@")[1] ?? "";
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
    if (this.hosts.has(domain)) return this.hosts.get(domain)!;
    const mx = this.options.mx ?? (async (d: string) => (await resolveMx(d)).map((r) => r.exchange));
    const host = hostOfMx(await mx(domain).catch(() => [])) ?? null;
    this.hosts.set(domain, host);
    this.hostsSignal[1](this.hostsSignal[0]() + 1);
    return host;
  }

  /**
   * How an account logs in now: its password, or an access token (refreshed
   * when it's about to run out, or when `renew`). Null when the password or a
   * new sign-in is needed. Throws when the provider can't be reached.
   */
  async loginOf(cfg: AccountConfig, renew = false): Promise<Login | null> {
    const secret = await this.secrets.get(cfg.id);
    if (!secret) return null;
    if (!cfg.oauth) return { pass: secret };
    const p = this.providerOf(cfg);
    if (!p) return null;
    const cached = this.tokens.get(cfg.id);
    if (cached && !renew && cached.expiresAt - Date.now() > 60_000) return { accessToken: cached.accessToken };
    try {
      const t = await refresh(p, secret);
      this.tokens.set(cfg.id, t);
      if (t.refreshToken && t.refreshToken !== secret) await this.secrets.set(cfg.id, t.refreshToken);
      return { accessToken: t.accessToken };
    } catch (e) {
      if (e instanceof OAuthError && e.revoked) return null;
      throw e;
    }
  }

  /**
   * Signs in with the address's provider in the browser, then adds the account
   * (or, already added, renews its sign-in). `signal` cancels the wait.
   */
  async signInAndAdd(email: string, opts: { sender?: string; signal?: AbortSignal; imap?: ImapSettings; smtp?: SmtpSettings } = {}): Promise<AccountConfig> {
    const existing = this.accounts().find((a) => a.id === email.trim().toLowerCase());
    if (!existing?.oauth) await this.lookUpHost(email);
    const p = this.providerOf({ email, oauth: existing?.oauth });
    if (!p) throw new Error(`Mantou Mail can't sign in to ${email} with its provider; use a password`);
    const got = await signIn(p, { loginHint: email.trim() || undefined, open: this.options.openUrl, signal: opts.signal });
    const wanted = email.trim().toLowerCase();
    if (wanted && got.email.toLowerCase() !== wanted) throw new Error(`You signed in as ${got.email}, not ${email.trim()}`);
    const had = this.accounts().find((a) => a.id === got.email.toLowerCase());
    return this.addAccount({
      email: got.email,
      oauth: { provider: p.id, tokens: got },
      // The provider's servers, with the address as the login (an account signing in again keeps its own).
      imap: opts.imap ?? had?.imap ?? { ...p.imap, user: got.email },
      smtp: opts.smtp ?? had?.smtp ?? { ...p.smtp, user: got.email },
      sender: opts.sender,
    });
  }

  private start(a: AccountConfig): AccountSync {
    this.syncs.get(a.id)?.stop();
    const sync = new AccountSync(a, {
      login: (renew) => this.loginOf(a, renew),
      store: this.store,
      newId: this.newId,
      onMessages: (account, list) => {
        // Local copies of sent mail that the server now has in Sent go from the store too (Mail.receive drops them).
        const arrived = new Set(list.map((m) => m.messageId).filter(Boolean));
        const copies = this.mail?.messages().filter((m) => m.account === account && !m.remote && !m.outbox && m.messageId && arrived.has(m.messageId)) ?? [];
        if (copies.length) this.store.remove(copies.map((m) => m.id));
        this.announceNew(account, list);
        this.mail?.receive(account, list);
      },
      onStatus: (account, s) => this.setStatus(account, s),
      localDrafts: (account) => new Set((this.mail?.messages() ?? this.store.messages()).filter((m) => m.account === account && !m.remote && m.folder === "drafts" && m.messageId).map((m) => m.messageId!)),
      expungeDelay: this.options.expungeDelay,
      window: this.options.window,
      retry: this.options.retry,
      onOlder: (account, folder, count) => {
        const key = `${account}:${folder}`;
        if (this.olderSignal[0]()[key] !== count) this.olderSignal[1]({ ...this.olderSignal[0](), [key]: count });
      },
    });
    this.syncs.set(a.id, sync);
    sync.start();
    return sync;
  }

  /** The app's change, as server changes (Mail's onChange). */
  onChange = (prev: Message[], next: Message[]) => {
    const before = new Map(prev.map((m) => [m.id, m]));
    const after = new Map(next.map((m) => [m.id, m]));
    const local: Message[] = [];
    for (const [id, a] of after) {
      const b = before.get(id);
      if (a === b) continue;
      const sync = this.syncs.get(a.account);
      if (a.remote) {
        if (!b) sync?.restored(a);
        else sync?.changed(b, a);
      } else if (this.isReal(a.account)) {
        local.push(a);
        if (a.folder === "drafts" && a.messageId) this.mirrorDraft(a.account, a.messageId, a);
        else if (b?.folder === "drafts" && b.messageId) this.mirrorDraft(a.account, b.messageId); // sent, trashed
        // Sent: into the outbox. Rescheduled or sent now: again. Unscheduled or deleted: out of it.
        if (a.outbox && (a.folder === "sent" || a.folder === "scheduled")) {
          if (!b?.outbox || b.outbox.at !== a.outbox.at) {
            this.cancelSend(id);
            this.queueSend(a);
          }
        } else if (b?.outbox) this.cancelSend(id);
      }
    }
    const gone: number[] = [];
    for (const [id, b] of before) {
      if (after.has(id)) continue;
      if (b.remote) this.syncs.get(b.account)?.removed(b);
      else {
        gone.push(id);
        this.cancelSend(id); // Undo Send
        if (b.folder === "drafts" && b.messageId) this.mirrorDraft(b.account, b.messageId); // discarded
      }
    }
    // Real accounts' local messages (drafts) are kept in the store too.
    if (local.length) this.store.put(local);
    if (gone.length) this.store.remove(gone);
  };

  /** Checks the login, saves the account and its password (or refresh token), and starts syncing it. */
  async addAccount(n: NewAccount): Promise<AccountConfig> {
    const smtp = n.smtp ?? { ...guessSmtp(n.email), user: n.imap.user };
    const login: Login = n.oauth ? { accessToken: n.oauth.tokens.accessToken } : { pass: n.password ?? "" };
    await checkLogin(n.imap, login);
    await checkSmtp(smtp, login);
    const email = n.email.trim();
    const id = email.toLowerCase();
    const existing = this.accounts().find((a) => a.id === id);
    const cfg: AccountConfig = {
      id,
      email,
      name: existing?.name ?? email,
      sender: n.sender?.trim() || existing?.sender || email.split("@")[0],
      imap: n.imap,
      smtp,
      ...(n.oauth ? { oauth: n.oauth.provider } : {}),
      ...(existing?.signature ? { signature: existing.signature } : {}),
    };
    this.store.saveAccount(cfg);
    this.listSignal[1](this.accounts());
    await this.secrets.set(id, n.oauth ? n.oauth.tokens.refreshToken : (n.password ?? ""));
    if (n.oauth) this.tokens.set(id, n.oauth.tokens);
    else this.tokens.delete(id);
    this.mail?.setAccounts(this.accounts(), this.store.messages());
    this.start(cfg);
    return cfg;
  }

  /** Sets what's added under mail sent from an account (empty: nothing). */
  setSignature(id: string, signature: string) {
    const cfg = this.accounts().find((a) => a.id === id);
    if (!cfg) return;
    const { signature: _, ...rest } = cfg;
    // Not the account list's signal: the Accounts dialog's rows would be remade at each key.
    this.store.saveAccount(signature.trim() ? { ...rest, signature } : rest);
  }

  /** Forgets an account: its settings, password and saved mail (nothing changes on the server). */
  async removeAccount(id: string) {
    await this.syncs.get(id)?.stop();
    this.syncs.delete(id);
    this.store.removeAccount(id);
    this.listSignal[1](this.accounts());
    await this.secrets.delete(id).catch(() => {});
    this.tokens.delete(id);
    const { [id]: _, ...rest } = this.statuses();
    this.statusSignal[1](rest);
    const left = this.accounts();
    if (left.length) this.mail?.setAccounts(left, this.store.messages());
    else this.mail?.setAccounts(SAMPLE_ACCOUNTS, sampleMessages());
  }

  /** The folders a mailbox shows, by account: All inboxes is every account's inbox, and so on. */
  private foldersOf(box: Mailbox): [string, Folder][] {
    const ids = this.accounts().map((a) => a.id);
    if (box.kind === "all") return ids.map((id) => [id, "inbox"]);
    if (box.kind === "account") return ids.includes(box.id) ? [[box.id, "inbox"]] : [];
    if (box.kind === "folder" && box.folder !== "snoozed") return ids.map((id) => [id, box.folder]);
    return []; // starred, labels and search are over what's kept
  }

  /** How many older messages of a mailbox are on the servers but not kept (0 for sample mail). */
  olderCount(box: Mailbox): number {
    const older = this.olderSignal[0]();
    return this.foldersOf(box).reduce((n, [id, f]) => n + (older[`${id}:${f}`] ?? 0), 0);
  }

  /** Gets more of a mailbox's older mail from the servers, and keeps it from now on. */
  async loadOlder(box: Mailbox) {
    await Promise.all(this.foldersOf(box).map(([id, f]) => this.syncs.get(id)?.loadOlder(f)));
  }

  /** The sync of an account, for tests. */
  syncOf(id: string) {
    return this.syncs.get(id);
  }

  async stop() {
    for (const t of this.outbox.values()) clearTimeout(t); // kept in the store: sent on the next start
    this.outbox.clear();
    await Promise.all([...this.syncs.values()].map((s) => s.stop()));
    this.syncs.clear();
  }
}
