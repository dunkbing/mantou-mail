// Real accounts: their settings and passwords, one AccountSync each, and the
// bridge to the app's state. The app's changes arrive as "messages before and
// after" (Mail's onChange) and become server changes here; the servers'
// messages arrive through Mail.receive.
import { createSignal } from "mantou-ui";
import { SAMPLE_ACCOUNTS, sampleMessages, type Message } from "../data";
import type { Mail } from "../state";
import { AccountSync, checkLogin, type SyncStatus } from "./imap";
import type { ImapSettings } from "./providers";
import type { Secrets } from "./secrets";
import type { AccountConfig, Store } from "./store";

export interface NewAccount {
  email: string;
  password: string;
  imap: ImapSettings;
  /** The sender name for mail from it (default: the part of the address before the @). */
  sender?: string;
}

export class Remote {
  private syncs = new Map<string, AccountSync>();
  private mail: Mail | null = null;
  private lastId: number;
  private readonly statusSignal = createSignal<Record<string, SyncStatus>>({});
  private readonly listSignal = createSignal<AccountConfig[]>([]);
  /** The real accounts, as a signal (accounts() reads the store). */
  readonly list = this.listSignal[0];
  /** Each account's sync status, by account id. */
  readonly statuses = this.statusSignal[0];

  constructor(readonly store: Store, readonly secrets: Secrets, private options: { expungeDelay?: number } = {}) {
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
      onMessages: (account, list) => this.mail?.receive(account, list),
      onStatus: (account, s) => this.setStatus(account, s),
      expungeDelay: this.options.expungeDelay,
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
      } else if (this.store.accounts().some((x) => x.id === a.account)) local.push(a);
    }
    const gone: number[] = [];
    for (const [id, b] of before) {
      if (after.has(id)) continue;
      if (b.remote) this.syncs.get(b.account)?.removed(b);
      else gone.push(id);
    }
    // Real accounts' local messages (drafts) are kept in the store too.
    if (local.length) this.store.put(local);
    if (gone.length) this.store.remove(gone);
  };

  /** Checks the login, saves the account and its password, and starts syncing it. */
  async addAccount(n: NewAccount): Promise<AccountConfig> {
    await checkLogin(n.imap, n.password);
    const email = n.email.trim();
    const id = email.toLowerCase();
    const existing = this.accounts().find((a) => a.id === id);
    const cfg: AccountConfig = {
      id,
      email,
      name: existing?.name ?? email,
      sender: n.sender?.trim() || existing?.sender || email.split("@")[0],
      imap: n.imap,
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

  /** The sync of an account, for tests. */
  syncOf(id: string) {
    return this.syncs.get(id);
  }

  async stop() {
    await Promise.all([...this.syncs.values()].map((s) => s.stop()));
    this.syncs.clear();
  }
}
