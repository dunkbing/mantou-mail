// Real accounts: their settings and passwords, one AccountSync each, and the
// bridge to the app's state. The app's changes arrive as "messages before and
// after" (Mail's onChange) and become server changes here; the servers'
// messages arrive through Mail.receive.
import { createSignal } from "mantou-ui";
import { SAMPLE_ACCOUNTS, sampleMessages, type Folder, type Message } from "../data";
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

  constructor(readonly store: Store, readonly secrets: Secrets, private options: { expungeDelay?: number; window?: number; undoSend?: number } = {}) {
    this.lastId = store.maxId();
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
    for (const m of mail.messages()) if (m.outbox && this.isReal(m.account)) this.queueSend(m, 0);
  }

  private isReal(account: string) {
    return this.store.accounts().some((x) => x.id === account);
  }

  private queueSend(m: Message, delay = this.options.undoSend ?? UNDO_SEND_MS) {
    if (this.outbox.has(m.id)) return;
    this.outbox.set(m.id, setTimeout(() => {
      this.outbox.delete(m.id);
      void this.deliver(m.id);
    }, delay));
  }

  private cancelSend(id: number) {
    clearTimeout(this.outbox.get(id));
    this.outbox.delete(id);
  }

  /** Sends a message from the outbox over SMTP, then files it in Sent. On failure it goes back to Drafts, with the reason. */
  private async deliver(id: number) {
    const mail = this.mail;
    const m = mail?.messages().find((x) => x.id === id);
    if (!mail || !m?.outbox) return;
    const cfg = this.accounts().find((a) => a.id === m.account);
    const password = cfg && (await this.secrets.get(cfg.id));
    const names = (m.to ?? []).map((c) => c.name).join(", ");
    const fail = (why: string) => {
      mail.backToDrafts(id);
      this.store.put(mail.messages().filter((x) => x.id === id));
      mail.note(`Couldn't send “${m.subject}”: ${why}. It's in Drafts.`);
    };
    if (!cfg || !password) return fail("the account's password is needed");
    const smtp = cfg.smtp ?? { ...guessSmtp(cfg.email), user: cfg.imap.user };
    const original = m.outbox.replyTo === undefined ? undefined : mail.messages().find((x) => x.id === m.outbox!.replyTo);
    let raw: Buffer;
    try {
      raw = await compose(m, original);
      await sendSmtp(smtp, password, m, raw);
    } catch (e) {
      return fail((e as Error).message);
    }
    mail.patchQuiet(id, { outbox: undefined });
    this.store.put(mail.messages().filter((x) => x.id === id));
    mail.note(`Sent to ${names}`);
    await this.syncs.get(cfg.id)?.fileSent(raw, !savesSent(smtp.host)).catch(() => {});
  }

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
        if (a.outbox && !b?.outbox) this.queueSend(a); // sent: into the outbox
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
