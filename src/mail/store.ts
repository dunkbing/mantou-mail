// The local copy of real accounts' mail, in SQLite: what the app shows at
// start, before (or without) a connection. Messages are stored as JSON next to
// where they are on the server; the app's local fields (labels, snooze,
// waiting for reply) travel in the JSON too.
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Account, Message } from "../data";
import type { ImapSettings } from "./providers";

export interface AccountConfig extends Account {
  imap: ImapSettings;
}

const DATES = new Set(["date", "waitingSince"]);
const revive = (k: string, v: unknown) => (DATES.has(k) && typeof v === "string" ? new Date(v) : v);

export class Store {
  readonly db: Database;

  constructor(dir: string | ":memory:") {
    this.db = new Database(dir === ":memory:" ? ":memory:" : join(dir, "mail.db"), { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, account TEXT NOT NULL, path TEXT, uid INTEGER, data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS messages_remote ON messages (account, path, uid) WHERE path IS NOT NULL;
      CREATE TABLE IF NOT EXISTS folders (account TEXT NOT NULL, path TEXT NOT NULL, uidvalidity INTEGER NOT NULL, PRIMARY KEY (account, path));
    `);
  }

  accounts(): AccountConfig[] {
    return this.db.query<{ data: string }, []>("SELECT data FROM accounts ORDER BY position").all().map((r) => JSON.parse(r.data));
  }

  saveAccount(a: AccountConfig) {
    const position = this.db.query<{ p: number | null }, [string]>("SELECT position AS p FROM accounts WHERE id = ?").get(a.id)?.p
      ?? (this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM accounts").get()!.n);
    this.db.query("INSERT OR REPLACE INTO accounts (id, position, data) VALUES (?, ?, ?)").run(a.id, position, JSON.stringify(a));
  }

  removeAccount(id: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM accounts WHERE id = ?").run(id);
      this.db.query("DELETE FROM messages WHERE account = ?").run(id);
      this.db.query("DELETE FROM folders WHERE account = ?").run(id);
    })();
  }

  /** Every stored message, of every account. */
  messages(account?: string): Message[] {
    const rows = account
      ? this.db.query<{ data: string }, [string]>("SELECT data FROM messages WHERE account = ?").all(account)
      : this.db.query<{ data: string }, []>("SELECT data FROM messages").all();
    return rows.map((r) => JSON.parse(r.data, revive));
  }

  maxId(): number {
    return this.db.query<{ m: number | null }, []>("SELECT MAX(id) AS m FROM messages").get()!.m ?? 0;
  }

  /** Inserts or replaces messages (by id). */
  put(list: Message[]) {
    const q = this.db.query("INSERT OR REPLACE INTO messages (id, account, path, uid, data) VALUES (?, ?, ?, ?, ?)");
    this.db.transaction(() => {
      for (const m of list) q.run(m.id, m.account, m.remote?.path ?? null, m.remote?.uid ?? null, JSON.stringify(m));
    })();
  }

  remove(ids: number[]) {
    const q = this.db.query("DELETE FROM messages WHERE id = ?");
    this.db.transaction(() => {
      for (const id of ids) q.run(id);
    })();
  }

  uidValidity(account: string, path: string): number | undefined {
    return this.db.query<{ v: number }, [string, string]>("SELECT uidvalidity AS v FROM folders WHERE account = ? AND path = ?").get(account, path)?.v;
  }

  setUidValidity(account: string, path: string, value: number) {
    this.db.query("INSERT OR REPLACE INTO folders (account, path, uidvalidity) VALUES (?, ?, ?)").run(account, path, value);
  }

  close() {
    this.db.close();
  }
}
