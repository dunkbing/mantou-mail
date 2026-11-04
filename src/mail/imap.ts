// One IMAP account, kept in sync: the last messages of its Inbox, Archive,
// Sent, Drafts and Trash in the local store, new mail as it arrives (IDLE on
// the Inbox, a resync every few minutes), and the user's changes sent to the
// server in order (kept while offline, sent again on reconnect).
import { ImapFlow, type ListResponse } from "imapflow";
import type { Folder, Message } from "../data";
import { attachmentsOf, parseMessage, type StructurePart } from "./parse";
import { isLocalHost, type ImapSettings } from "./providers";
import type { AccountConfig, Store } from "./store";

/** How many of each folder's newest messages are kept. */
export const WINDOW = 200;
const RESYNC_MS = 5 * 60_000;
/** How long "Delete forever" waits before it's sent, so undo can still bring the message back. */
export const EXPUNGE_DELAY_MS = 10_000;

export type SyncState = "connecting" | "syncing" | "ready" | "offline" | "error" | "needs-password";
export interface SyncStatus {
  state: SyncState;
  /** What's happening, or what went wrong, in words for the status bar. */
  detail: string;
}

export interface SyncHooks {
  store: Store;
  /** A new app-wide message id. */
  newId(): number;
  /** The account's messages as the server has them (and the app's local fields). */
  onMessages(account: string, list: Message[]): void;
  onStatus(account: string, status: SyncStatus): void;
  /** How many older messages a folder has on the server beyond what's kept. */
  onOlder?(account: string, folder: Folder, count: number): void;
  /** How long "Delete forever" waits (default EXPUNGE_DELAY_MS). */
  expungeDelay?: number;
  /** How many of a folder's newest messages are kept at first, and added by "Load older" (default WINDOW). */
  window?: number;
}

/** The folders the app shows, by their special-use flag, then by common names. */
const FOLDERS: [Folder, string[], RegExp][] = [
  ["inbox", ["\\Inbox"], /^inbox$/i],
  ["archive", ["\\Archive", "\\All"], /^(archives?|all mail|\[gmail\]\/all mail)$/i],
  ["sent", ["\\Sent"], /^(sent( items| messages| mail)?|\[gmail\]\/sent mail)$/i],
  ["drafts", ["\\Drafts"], /^drafts?$/i],
  ["trash", ["\\Trash"], /^(trash|deleted( items| messages)?|bin|\[gmail\]\/(trash|bin))$/i],
];
/** When the same message is in several folders (Gmail's All Mail), which copy shows. */
const PRIORITY: Record<Folder, number> = { inbox: 0, snoozed: 0, drafts: 1, scheduled: 1, sent: 2, trash: 3, archive: 4 };

export function folderPaths(list: ListResponse[]): Map<Folder, string> {
  const paths = new Map<Folder, string>();
  for (const [folder, uses, names] of FOLDERS) {
    const box = list.find((b) => b.specialUse && uses.includes(b.specialUse)) ?? list.find((b) => names.test(b.path) || names.test(b.name));
    if (box) paths.set(folder, box.path);
  }
  return paths;
}

/** Login failures in words a person can act on. */
export function explain(e: unknown, settings: ImapSettings): string {
  const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (err.authenticationFailed) return `The server didn't accept the password${err.responseText ? `: ${err.responseText}` : ""}`;
  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return `Can't find ${settings.host}: check the server name, or the connection`;
  if (err.code === "ECONNREFUSED") return `${settings.host} refused the connection on port ${settings.port}`;
  if (err.code === "ETIMEDOUT" || err.code === "CONNECT_TIMEOUT" || err.code === "GREETING_TIMEOUT") return `${settings.host} didn't answer on port ${settings.port}`;
  if (err.code === "NoConnection" || /STARTTLS/i.test(err.message ?? "")) return `${settings.host} doesn't offer an encrypted connection on port ${settings.port}; try 993`;
  return err.responseText || err.message || String(e);
}

export function newClient(s: ImapSettings, password: string): ImapFlow {
  return new ImapFlow({
    host: s.host,
    port: s.port,
    secure: s.secure,
    // Without TLS from the start, STARTTLS is required: passwords never go in the clear (except to this machine).
    doSTARTTLS: s.secure || isLocalHost(s.host) ? undefined : true,
    auth: { user: s.user, pass: password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 5 * 60_000,
    autoIdleDelay: 1_000, // IDLE (new mail arrives) a second after the last command, not 15
    clientInfo: { name: "Mantou Mail" },
  });
}

/** Logs in and out once, for the Add account form; throws a readable error. */
export async function checkLogin(s: ImapSettings, password: string): Promise<void> {
  const c = newClient(s, password);
  c.on("error", () => {});
  try {
    await c.connect();
    await c.logout();
  } catch (e) {
    c.close();
    throw new Error(explain(e, s));
  }
}

type Op =
  | { kind: "move"; id: number; to: Folder }
  | { kind: "flag"; id: number; flag: "\\Seen" | "\\Flagged"; on: boolean }
  | { kind: "expunge"; id: number };

export class AccountSync {
  private client: ImapFlow | null = null;
  private paths = new Map<Folder, string>();
  /** The account's messages that are on the server, by app id. */
  private byId = new Map<number, Message>();
  /** Changes not yet on the server, in order. */
  private pending: { seq: number; op: Op }[] = [];
  /** Messages with changes in `pending`: the server's older view of them is ignored until they're sent. */
  private dirty = new Map<number, number>();
  private deletions = new Map<number, ReturnType<typeof setTimeout>>();
  private chain: Promise<unknown> = Promise.resolve();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private failures = 0;
  /** Resolves when the first full sync after start() is done (or failed). */
  readonly firstSync: Promise<void>;
  private firstSyncDone!: () => void;

  constructor(readonly cfg: AccountConfig, private password: string, private hooks: SyncHooks) {
    for (const m of hooks.store.messages(cfg.id)) if (m.remote) this.byId.set(m.id, m);
    // Changes made before a quit that weren't on the server yet.
    this.pending = hooks.store.pending<Op>(cfg.id);
    for (const { op } of this.pending) this.dirty.set(op.id, (this.dirty.get(op.id) ?? 0) + 1);
    this.firstSync = new Promise((r) => (this.firstSyncDone = r));
  }

  private status(state: SyncState, detail: string) {
    this.hooks.onStatus(this.cfg.id, { state, detail });
  }

  /** Runs one thing at a time on the connection. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.debounce) clearTimeout(this.debounce);
    // Deletions still waiting for their undo window are sent now.
    for (const [id, t] of this.deletions) {
      clearTimeout(t);
      this.queue({ kind: "expunge", id });
    }
    this.deletions.clear();
    const c = this.client;
    this.client = null;
    if (c?.usable) {
      await this.run(() => this.flush(c)).catch(() => {});
      await c.logout().catch(() => c.close());
    } else c?.close();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
  }

  private async connect() {
    if (this.stopped) return;
    this.status("connecting", `Connecting to ${this.cfg.imap.host}…`);
    const c = newClient(this.cfg.imap, this.password);
    c.on("error", () => {}); // reported through close and the failed command
    try {
      await c.connect();
    } catch (e) {
      c.close();
      const err = e as { authenticationFailed?: boolean };
      if (err.authenticationFailed) {
        this.status("needs-password", explain(e, this.cfg.imap));
        this.firstSyncDone();
        return;
      }
      this.offline(explain(e, this.cfg.imap));
      return;
    }
    if (this.stopped) return void c.logout().catch(() => c.close());
    this.client = c;
    this.failures = 0;
    c.on("close", () => {
      if (this.client === c) {
        this.client = null;
        this.offline("Connection lost");
      }
    });
    c.on("exists", (e: { path: string }) => this.soon(e.path));
    c.on("expunge", (e: { path: string }) => this.soon(e.path));
    c.on("flags", (e: { path: string; uid?: number; flags: Set<string> }) => this.flagsChanged(e));
    try {
      await this.run(async () => {
        this.paths = folderPaths(await c.list());
        await this.flush(c);
      });
      await this.syncAll();
    } catch (e) {
      this.status("error", explain(e, this.cfg.imap));
    }
    this.firstSyncDone();
  }

  private offline(why: string) {
    if (this.stopped) return;
    this.failures++;
    const wait = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(this.failures, 8));
    this.status("offline", `${why}. Showing saved mail; trying again in ${Math.round(wait / 1000)} s`);
    this.firstSyncDone();
    this.later(wait, () => void this.connect());
  }

  /** Syncs every folder, then waits on the Inbox for new mail. */
  async syncAll() {
    const c = this.client;
    if (!c) return;
    for (const folder of ["inbox", "drafts", "sent", "trash", "archive"] as Folder[]) {
      if (!this.paths.has(folder)) continue;
      this.status("syncing", `Syncing ${this.cfg.email}: ${folder[0].toUpperCase()}${folder.slice(1)}`);
      await this.run(() => this.syncFolder(c, folder));
      this.emit();
    }
    await this.run(() => this.idleOnInbox(c));
    this.status("ready", `${this.cfg.email} is up to date`);
    this.later(RESYNC_MS, () => void this.syncAll().catch(() => {}));
  }

  /** Mail arrived or left in a folder: sync it shortly (several events come together). */
  private soon(path: string) {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const folder = [...this.paths].find(([, p]) => p === path)?.[0];
      const c = this.client;
      if (!folder || !c) return;
      void this.run(async () => {
        await this.syncFolder(c, folder);
        await this.idleOnInbox(c);
      }).then(() => this.emit(), () => {});
    }, 150);
  }

  private flagsChanged(e: { path: string; uid?: number; flags: Set<string> }) {
    const m = [...this.byId.values()].find((x) => x.remote!.path === e.path && x.remote!.uid === e.uid);
    if (!m) return this.soon(e.path);
    if (this.dirty.has(m.id)) return;
    this.put({ ...m, unread: !e.flags.has("\\Seen"), starred: e.flags.has("\\Flagged") });
    this.emit();
  }

  private async idleOnInbox(c: ImapFlow) {
    const inbox = this.paths.get("inbox");
    // imapflow IDLEs on the open mailbox when the connection has nothing else to do.
    if (inbox && c.mailbox && (c.mailbox as { path: string }).path !== inbox) await c.mailboxOpen(inbox);
    else if (inbox && !c.mailbox) await c.mailboxOpen(inbox);
  }

  private put(m: Message) {
    this.byId.set(m.id, m);
    this.hooks.store.put([m]);
  }

  private drop(ids: number[]) {
    for (const id of ids) this.byId.delete(id);
    this.hooks.store.remove(ids);
  }

  /** The newest WINDOW messages of a folder, as the server has them now. */
  private async syncFolder(c: ImapFlow, folder: Folder) {
    const path = this.paths.get(folder)!;
    const lock = await c.getMailboxLock(path);
    try {
      const box = c.mailbox as { uidValidity: bigint; exists: number };
      const validity = Number(box.uidValidity);
      let known = [...this.byId.values()].filter((m) => m.remote!.path === path);
      if (this.hooks.store.uidValidity(this.cfg.id, path) !== validity) {
        this.drop(known.map((m) => m.id));
        known = [];
        this.hooks.store.setUidValidity(this.cfg.id, path, validity);
      }
      if (box.exists === 0) {
        this.hooks.onOlder?.(this.cfg.id, folder, 0);
        return this.drop(known.map((m) => m.id));
      }

      const listed: { uid: number; flags: Set<string>; size: number }[] = [];
      const window = this.hooks.store.window(this.cfg.id, folder, this.hooks.window ?? WINDOW);
      this.hooks.onOlder?.(this.cfg.id, folder, Math.max(0, box.exists - window));
      for await (const m of c.fetch(`${Math.max(1, box.exists - window + 1)}:*`, { uid: true, flags: true, size: true })) {
        listed.push({ uid: m.uid, flags: m.flags ?? new Set(), size: m.size ?? 0 });
      }
      const onServer = new Set(listed.map((l) => l.uid));
      const byUid = new Map(known.map((m) => [m.remote!.uid, m]));
      this.drop(known.filter((m) => !onServer.has(m.remote!.uid) && !this.dirty.has(m.id)).map((m) => m.id));

      for (const l of listed) {
        const m = byUid.get(l.uid);
        if (!m || this.dirty.has(m.id)) continue;
        const unread = !l.flags.has("\\Seen"), starred = l.flags.has("\\Flagged");
        if (m.unread !== unread || m.starred !== starred) this.put({ ...m, unread, starred });
      }

      const fresh = listed.filter((l) => !byUid.has(l.uid));
      for (let i = 0; i < fresh.length; i += 25) {
        const chunk = fresh.slice(i, i + 25);
        const big = new Set(chunk.filter((l) => l.size > 1_000_000).map((l) => l.uid));
        for (const [uids, source] of [[chunk.filter((l) => !big.has(l.uid)), true], [chunk.filter((l) => big.has(l.uid)), { maxLength: 300_000 }]] as const) {
          if (!uids.length) continue;
          for await (const f of c.fetch(uids.map((l) => l.uid).join(","), { uid: true, flags: true, internalDate: true, threadId: true, bodyStructure: true, source }, { uid: true })) {
            if (!f.source) continue;
            const p = await parseMessage(f.source, {
              serverThreadId: f.threadId,
              internalDate: f.internalDate instanceof Date ? f.internalDate : undefined,
              fallbackKey: `u:${path}:${f.uid}`,
            });
            const flags = f.flags ?? new Set<string>();
            this.put({
              id: this.hooks.newId(),
              account: this.cfg.id,
              folder,
              from: p.from,
              to: p.to,
              ...(p.cc.length ? { cc: p.cc } : {}),
              ...(p.bcc.length ? { bcc: p.bcc } : {}),
              subject: p.subject,
              body: p.body,
              date: p.date,
              unread: !flags.has("\\Seen"),
              starred: flags.has("\\Flagged"),
              important: p.important,
              labels: [],
              thread: p.threadKey,
              remote: { path, uid: f.uid },
              messageId: p.messageId,
              attachments: attachmentsOf(f.bodyStructure as StructurePart | undefined),
            });
          }
        }
      }
    } finally {
      lock.release();
    }
  }

  /** Sends the account's messages to the app: one copy per message (the most specific folder's). */
  emit() {
    const shown = new Map<string, Message>();
    const out: Message[] = [];
    for (const m of this.byId.values()) {
      if (this.deletions.has(m.id)) continue;
      if (!m.messageId) {
        out.push(m);
        continue;
      }
      const other = shown.get(m.messageId);
      if (!other || PRIORITY[m.folder] < PRIORITY[other.folder]) shown.set(m.messageId, m);
    }
    this.hooks.onMessages(this.cfg.id, [...out, ...shown.values()]);
  }

  // ------------------------------------------------------------ changes from the app

  /** The app changed one of this account's messages (folder, read, star, or its local fields). */
  changed(before: Message, after: Message) {
    const m = this.byId.get(after.id);
    if (!m) return;
    if (before.folder !== after.folder && after.folder !== "snoozed") this.queue({ kind: "move", id: after.id, to: after.folder });
    if (before.unread !== after.unread) this.queue({ kind: "flag", id: after.id, flag: "\\Seen", on: !after.unread });
    if (before.starred !== after.starred) this.queue({ kind: "flag", id: after.id, flag: "\\Flagged", on: after.starred });
    this.put({ ...after, remote: m.remote }); // the local fields (labels, snooze) are kept here
    void this.kick();
  }

  /** The app deleted a message for good: sent after the undo window, unless it comes back. */
  removed(m: Message) {
    if (!this.byId.has(m.id)) return;
    this.deletions.set(m.id, setTimeout(() => {
      this.deletions.delete(m.id);
      this.queue({ kind: "expunge", id: m.id });
      void this.kick();
    }, this.hooks.expungeDelay ?? EXPUNGE_DELAY_MS));
  }

  /** A message deleted for good came back (undo) before it was sent. */
  restored(m: Message) {
    const t = this.deletions.get(m.id);
    if (t) clearTimeout(t);
    this.deletions.delete(m.id);
  }

  private queue(op: Op) {
    this.pending.push({ seq: this.hooks.store.addPending(this.cfg.id, op), op });
    this.dirty.set(op.id, (this.dirty.get(op.id) ?? 0) + 1);
  }

  /** Sends what's pending, if connected; resolves when it's done. */
  kick(): Promise<void> {
    const c = this.client;
    if (!c) return Promise.resolve();
    return this.run(async () => {
      await this.flush(c);
      await this.idleOnInbox(c);
    }).then(() => this.emit(), (e) => this.status("error", explain(e, this.cfg.imap)));
  }

  private async flush(c: ImapFlow) {
    while (this.pending.length && c.usable) {
      const { seq, op } = this.pending[0];
      try {
        await this.apply(c, op);
      } catch (e) {
        if (!c.usable) return; // connection lost: kept, sent on reconnect
        this.status("error", `Couldn't change a message on the server: ${explain(e, this.cfg.imap)}`);
        const m = this.byId.get(op.id);
        const where = m && [...this.paths].find(([, p]) => p === m.remote!.path)?.[0];
        if (op.kind === "move" && m && where) this.put({ ...m, folder: where }); // it's still where the server has it
      }
      this.pending.shift();
      this.hooks.store.removePending(seq);
      const n = (this.dirty.get(op.id) ?? 1) - 1;
      if (n > 0) this.dirty.set(op.id, n);
      else this.dirty.delete(op.id);
    }
  }

  private async apply(c: ImapFlow, op: Op) {
    const m = this.byId.get(op.id);
    if (!m?.remote) return;
    const { path, uid } = m.remote;
    if (op.kind === "move") {
      const to = this.paths.get(op.to);
      if (!to || to === path) return;
      const lock = await c.getMailboxLock(path);
      try {
        const res = await c.messageMove(String(uid), to, { uid: true });
        const newUid = res && res.uidMap?.get(uid);
        if (newUid) this.put({ ...m, folder: op.to, remote: { path: to, uid: newUid } });
        else this.drop([m.id]); // no UIDPLUS: the next sync of the target finds it again
      } finally {
        lock.release();
      }
    } else if (op.kind === "flag") {
      const lock = await c.getMailboxLock(path);
      try {
        if (op.on) await c.messageFlagsAdd(String(uid), [op.flag], { uid: true });
        else await c.messageFlagsRemove(String(uid), [op.flag], { uid: true });
      } finally {
        lock.release();
      }
    } else {
      const lock = await c.getMailboxLock(path);
      try {
        await c.messageDelete(String(uid), { uid: true });
      } finally {
        lock.release();
      }
      this.drop([m.id]);
    }
  }

  /**
   * Mail just sent over SMTP: filed in Sent here (`append`) where the provider
   * doesn't do that itself, then Sent is synced, so its copy replaces the
   * local one. Offline, the local copy stays.
   */
  async fileSent(raw: Buffer, append: boolean) {
    const c = this.client;
    const path = this.paths.get("sent");
    if (!c || !path) return;
    await this.run(async () => {
      if (append) await c.append(path, raw, ["\\Seen"]);
      await this.syncFolder(c, "sent");
      await this.idleOnInbox(c);
    });
    this.emit();
  }

  /** One MIME part of a message on the server, decoded (an attachment being opened or forwarded). */
  async download(id: number, part: string): Promise<Uint8Array> {
    const m = this.byId.get(id);
    const c = this.client;
    if (!m?.remote) throw new Error("this message isn't on the server any more");
    if (!c) throw new Error(`${this.cfg.email} is offline`);
    const { path, uid } = m.remote;
    return this.run(async () => {
      const lock = await c.getMailboxLock(path);
      try {
        const { content } = await c.download(String(uid), part, { uid: true });
        if (!content) throw new Error("the server sent no content for this attachment");
        const chunks: Uint8Array[] = [];
        for await (const chunk of content) chunks.push(chunk as Uint8Array);
        return new Uint8Array(Buffer.concat(chunks));
      } finally {
        lock.release();
      }
    });
  }

  /** Keeps `more` older messages of a folder, and fetches them now. */
  async loadOlder(folder: Folder, more = this.hooks.window ?? WINDOW) {
    const c = this.client;
    if (!c || !this.paths.has(folder)) return;
    this.hooks.store.setWindow(this.cfg.id, folder, this.hooks.store.window(this.cfg.id, folder, this.hooks.window ?? WINDOW) + more);
    this.status("syncing", `Getting older mail of ${this.cfg.email}`);
    await this.run(async () => {
      await this.syncFolder(c, folder);
      await this.idleOnInbox(c);
    });
    this.emit();
    this.status("ready", `${this.cfg.email} is up to date`);
  }

  /** Waits until everything queued so far has been sent (tests, and before quitting). */
  async settle() {
    await this.kick();
    await this.chain;
  }
}
