// Real accounts: their settings and passwords, one AccountSync each, and the
// bridge to the app's state. The app's changes arrive as "messages before and
// after" (Mail's onChange) and become server changes here; the servers'
// messages arrive through Mail.receive.
import { createSignal } from "mantou-ui";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SAMPLE_ACCOUNTS, longDate, now, recipients, sampleMessages, type Attachment, type Folder, type Message } from "../data";
import { Blobs } from "./blobs";
import type { MessageOptions } from "mantou-ui";
import { confirm, downloadsDir, freeName, hasDialogs, openWithSystem, pickFiles, pickSavePath, typeOf } from "./files";
import type { Mail, Mailbox } from "../state";
import { AccountSync, checkLogin, type SyncStatus } from "./imap";
import { guessSmtp, savesSent, type ImapSettings, type SmtpSettings } from "./providers";
import { checkSmtp, compose, send as sendSmtp } from "./smtp";
import type { Secrets } from "./secrets";
import type { AccountConfig, Store } from "./store";

/** How long a message waits in the outbox before it's sent: Undo Send takes it back meanwhile. */
export const UNDO_SEND_MS = 10_000;

export interface NewAccount {
  email: string;
  password: string;
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
      undoSend?: number;
      /** Where attachments' bytes are kept (default: a folder in the system's temp folder). */
      blobs?: Blobs;
      /** Where opened attachments are saved (default: Downloads), and what opens them (default: the system). */
      downloads?: string;
      open?: (path: string) => void;
      /** Whether the system's dialogs can be shown (default: a guess, see hasDialogs). */
      dialogs?: boolean;
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
    return accounts.length ? { messages: this.store.messages(), accounts } : { messages: sampleMessages(), accounts: SAMPLE_ACCOUNTS };
  }

  private setStatus(id: string, s: SyncStatus) {
    this.statusSignal[1]({ ...this.statuses(), [id]: s });
  }

  /** Connects the app's state, and starts syncing every account that has its password. */
  async attach(mail: Mail) {
    this.mail = mail;
    for (const a of this.accounts()) {
      const password = await this.secrets.get(a.id);
      if (password) this.start(a, password);
      else this.setStatus(a.id, { state: "needs-password", detail: `Enter the password for ${a.email} to sync it` });
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
    const password = cfg && (await this.secrets.get(cfg.id));
    const names = recipients(m).map((c) => c.name).join(", ");
    const fail = (why: string) => {
      mail.backToDrafts(id);
      this.store.put(mail.messages().filter((x) => x.id === id));
      mail.note(`Couldn't send “${m.subject}”: ${why}. It's in Drafts.`);
    };
    if (!cfg || !password) return fail("the account's password is needed");
    const smtp = cfg.smtp ?? { ...guessSmtp(cfg.email), user: cfg.imap.user };
    const original = m.outbox.replyTo === undefined ? undefined : mail.messages().find((x) => x.id === m.outbox!.replyTo);
    let raw: Buffer;
    let sentCopy: Buffer;
    try {
      const files = await Promise.all((m.attachments ?? []).map(async (a) => ({ name: a.name, type: a.type, content: await this.bytesOf(a) })));
      const out = { ...m, date: now() };
      raw = await compose(out, original, files);
      // The copy filed in Sent keeps the Bcc line, so you can see who got it.
      sentCopy = m.bcc?.length ? await compose(out, original, files, { keepBcc: true }) : raw;
      await sendSmtp(smtp, password, m, raw);
    } catch (e) {
      return fail((e as Error).message);
    }
    mail.patchQuiet(id, { outbox: undefined, folder: "sent", date: now() });
    this.store.put(mail.messages().filter((x) => x.id === id));
    mail.note(late ? `Sent to ${names}: it was scheduled for ${longDate(new Date(late))}, while the app wasn't running` : `Sent to ${names}`);
    await this.syncs.get(cfg.id)?.fileSent(sentCopy, !savesSent(smtp.host)).catch(() => {});
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

  private get dialogs() {
    return this.options.dialogs ?? hasDialogs();
  }
  /** The system's file dialog (null where there's none: the composer then asks for a path). */
  pickFiles = () => pickFiles(this.dialogs);
  /** The system's save dialog (a free name in Downloads where there's none). */
  pickSavePath = (dir: string, name: string) => pickSavePath(dir, name, this.dialogs);
  /** The system's message box, for a yes or no (yes where there's none). */
  confirm = (options: MessageOptions) => confirm(options, this.dialogs);

  /** Waits for the outbox to empty (tests). */
  async outboxEmpty() {
    while (this.outbox.size || this.mail?.messages().some((m) => m.outbox && this.isReal(m.account))) await Bun.sleep(5);
  }

  newId = () => {
    this.lastId = Math.max(this.lastId, ...(this.mail?.messages().map((m) => m.id) ?? [0])) + 1;
    return this.lastId;
  };

  private start(a: AccountConfig, password: string): AccountSync {
    this.syncs.get(a.id)?.stop();
    const sync = new AccountSync(a, password, {
      store: this.store,
      newId: this.newId,
      onMessages: (account, list) => {
        // Local copies of sent mail that the server now has in Sent go from the store too (Mail.receive drops them).
        const arrived = new Set(list.map((m) => m.messageId).filter(Boolean));
        const copies = this.mail?.messages().filter((m) => m.account === account && !m.remote && !m.outbox && m.messageId && arrived.has(m.messageId)) ?? [];
        if (copies.length) this.store.remove(copies.map((m) => m.id));
        this.mail?.receive(account, list);
      },
      onStatus: (account, s) => this.setStatus(account, s),
      expungeDelay: this.options.expungeDelay,
      window: this.options.window,
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
      }
    }
    // Real accounts' local messages (drafts) are kept in the store too.
    if (local.length) this.store.put(local);
    if (gone.length) this.store.remove(gone);
  };

  /** Checks the login, saves the account and its password, and starts syncing it. */
  async addAccount(n: NewAccount): Promise<AccountConfig> {
    const smtp = n.smtp ?? { ...guessSmtp(n.email), user: n.imap.user };
    await checkLogin(n.imap, n.password);
    await checkSmtp(smtp, n.password);
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
    };
    this.store.saveAccount(cfg);
    this.listSignal[1](this.accounts());
    await this.secrets.set(id, n.password);
    this.mail?.setAccounts(this.accounts(), this.store.messages());
    this.start(cfg, n.password);
    return cfg;
  }

  /** Forgets an account: its settings, password and saved mail (nothing changes on the server). */
  async removeAccount(id: string) {
    await this.syncs.get(id)?.stop();
    this.syncs.delete(id);
    this.store.removeAccount(id);
    this.listSignal[1](this.accounts());
    await this.secrets.delete(id).catch(() => {});
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
