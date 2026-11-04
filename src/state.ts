// Mantou Mail's state: Solid signals and the actions the UI and the keyboard
// share. Nothing here knows about views.
import { batch, createMemo, createSignal } from "mantou-ui";
import { LABELS, SAMPLE_ACCOUNTS, dedupe, recipients, longDate, now, sampleMessages, threadOf, type Account, type Attachment, type Contact, type Folder, type Message } from "./data";

/** What most servers take in one message (attachments are about a third bigger once encoded). */
const MAX_SEND = 25_000_000;

export type Mailbox =
  | { kind: "all" }
  | { kind: "account"; id: string }
  | { kind: "folder"; folder: Exclude<Folder, "inbox"> }
  | { kind: "starred" }
  | { kind: "label"; id: string }
  | { kind: "search"; query: string };

export type Tab = "important" | "other";

export function sameMailbox(a: Mailbox, b: Mailbox): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mailboxName(m: Mailbox, accounts: Account[] = SAMPLE_ACCOUNTS): string {
  switch (m.kind) {
    case "all": return "All inboxes";
    case "account": return accounts.find((a) => a.id === m.id)?.name ?? m.id;
    case "folder": return m.folder[0].toUpperCase() + m.folder.slice(1);
    case "starred": return "Starred";
    case "label": return LABELS.find((l) => l.id === m.id)?.name ?? m.id;
    case "search": return m.query ? `Results for “${m.query}”` : "Search";
  }
}

/** Every word of the query appears in the sender, the subject or the body (case-insensitive). */
export function matches(msg: Message, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const hay = [msg.from.name, msg.from.email, msg.subject, ...msg.body].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function inMailbox(msg: Message, m: Mailbox): boolean {
  switch (m.kind) {
    case "all": return msg.folder === "inbox";
    case "account": return msg.folder === "inbox" && msg.account === m.id;
    case "folder": return msg.folder === m.folder;
    case "starred": return msg.starred && msg.folder !== "trash";
    case "label": return msg.labels.includes(m.id) && msg.folder !== "trash";
    case "search": return msg.folder !== "trash" && matches(msg, m.query);
  }
}

/** Where "move to inbox" applies: messages filed away rather than in an inbox. */
export const isFiledAway = (msg: Message) => msg.folder === "archive" || msg.folder === "trash" || msg.folder === "snoozed";

/** Inboxes split into Important (people, security) and Other (everything else). */
export const usesTabs = (m: Mailbox) => m.kind === "all" || m.kind === "account";

export const QUICK_REPLIES = ["Thanks, got it!", "Sounds good — see you then.", "Let me check and get back to you today."];

/** Snooze presets, relative to NOW (Tuesday 3 November, 09:30). */
export const SNOOZE_OPTIONS = [
  { name: "Later today", time: "18:00", until: "Today, 18:00" },
  { name: "Tomorrow", time: "08:00", until: "Tomorrow, 08:00" },
  { name: "This weekend", time: "Sat 09:00", until: "Sat 7 Nov, 09:00" },
  { name: "Next week", time: "Mon 08:00", until: "Mon 9 Nov, 08:00" },
];

/** Send Later presets, from a moment: in an hour, tomorrow morning and afternoon, Monday morning. */
export function sendLaterOptions(from: Date): { name: string; at: Date }[] {
  const at = (days: number, h: number) => {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const toMonday = ((8 - from.getDay()) % 7) || 7; // the next Monday, a week on if it's Monday
  return [
    { name: "In an hour", at: new Date(Math.ceil((from.getTime() + 3_600_000) / 300_000) * 300_000) },
    { name: "Tomorrow morning", at: at(1, 8) },
    { name: "Tomorrow afternoon", at: at(1, 13) },
    { name: toMonday === 1 ? "Monday morning (tomorrow)" : "Monday morning", at: at(toMonday, 8) },
  ];
}

/** The panel under the reader: the reply composer, snooze times, or labels. */
export type Panel = "reply" | "snooze" | "labels" | null;

/** What the composer holds: a new message or a reply, typed but not sent. */
export interface Draft {
  kind: "new" | "reply";
  /** The draft's message in Drafts, once saved. */
  id: number | null;
  account: string;
  /** As typed: "Priya Shah <priya@northwind.dev>, jonas@acme.io". */
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyTo?: number;
  attachments?: Attachment[];
}

const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

/**
 * Parses a To line: comma-separated addresses, each "Name <email>" or a bare
 * email. A bare email takes the name of a known sender with that address.
 */
export function parseRecipients(text: string, known: Contact[] = []): { ok: Contact[]; bad: string[] } {
  const ok: Contact[] = [], bad: string[] = [];
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.*?)\s*<([^<>]+)>$/.exec(part);
    const email = (m ? m[2] : part).trim(), name = m?.[1].replace(/^"|"$/g, "").trim();
    if (!EMAIL.test(email)) bad.push(part);
    else ok.push({ name: name || known.find((k) => k.email.toLowerCase() === email.toLowerCase())?.name || email, email });
  }
  return { ok, bad };
}

/**
 * People to suggest for the address being typed (after the last comma): those
 * whose name or address has a word starting with it, not already on the line.
 */
export function suggestRecipients(line: string, known: Contact[], max = 4): Contact[] {
  const typed = line.slice(line.lastIndexOf(",") + 1).trim().toLowerCase();
  if (!typed || /[<>]/.test(typed)) return [];
  const have = new Set(parseRecipients(line.slice(0, line.lastIndexOf(",") + 1)).ok.map((c) => c.email.toLowerCase()));
  const words = (c: Contact) => [...c.name.toLowerCase().split(/\s+/), c.name.toLowerCase(), ...c.email.toLowerCase().split(/[@._\-+]/), c.email.toLowerCase()];
  return known.filter((c) => !have.has(c.email.toLowerCase()) && words(c).some((w) => w.startsWith(typed))).slice(0, max);
}

/** The line with the address being typed replaced by `c`, ready for the next one. */
export function acceptRecipient(line: string, c: Contact): string {
  const head = line.slice(0, line.lastIndexOf(",") + 1).trim();
  return `${head ? `${head} ` : ""}${formatContacts([c])}, `;
}

/** Whether text you wrote says something is attached (a forward's quoted part left out). */
export function mentionsAttachment(body: string): boolean {
  const own = body.split(/^-{5,} Forwarded message -{5,}$/m)[0];
  return /\b(attached|attachments?|attaching|enclosed)\b/i.test(own);
}

const names = (cs: Contact[]) => cs.map((c) => c.name).join(", ");

export const formatContacts = (cs: Contact[]) => cs.map((c) => (c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email)).join(", ");

/** A body as typed, as the message's paragraphs (split at blank lines). */
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

const reSubject = (subject: string) => (subject.startsWith("Re: ") ? subject : `Re: ${subject}`);

export interface MailOptions {
  /** The accounts the messages belong to (default: the sample ones). */
  accounts?: Account[];
  /**
   * Called after every change the user makes (not after `receive`), with the
   * messages before and after: how changes reach the server.
   */
  onChange?: (prev: Message[], next: Message[]) => void;
}

export function createMail(initial: Message[] = sampleMessages(), options: MailOptions = {}) {
  const [messages, setMessagesRaw] = createSignal(initial);
  const setMessages = (next: Message[]) => {
    const prev = messages();
    setMessagesRaw(next);
    options.onChange?.(prev, next);
  };
  const [accounts, setAccountsRaw] = createSignal<Account[]>(options.accounts ?? SAMPLE_ACCOUNTS);
  const accountOf = (id: string) => accounts().find((a) => a.id === id) ?? accounts()[0];
  /** Mail from one of your accounts. */
  const isMine = (c: Contact) => accounts().some((a) => a.email.toLowerCase() === c.email.toLowerCase());
  const fromAccount = (id: string): Contact => ({ name: accountOf(id).sender, email: accountOf(id).email });
  const [mailbox, setMailbox] = createSignal<Mailbox>({ kind: "all" });
  const [tab, setTab] = createSignal<Tab>("important");
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [status, setStatusText] = createSignal("");
  /** The status reports a change that undo reverses (not, say, "Draft saved"). */
  const [undoable, setUndoable] = createSignal(false);
  const setStatus = (text: string, canUndo = false) => batch(() => {
    setStatusText(text);
    setUndoable(canUndo);
  });
  /** The search field has the keyboard focus. */
  const [searching, setSearching] = createSignal(false);
  /** The new-message composer is open (replies are composed in the reply panel). */
  const [composing, setComposing] = createSignal(false);
  const [replyingAll, setReplyingAll] = createSignal(false);
  /** The text the forgotten-attachment warning was shown for (sending it again goes ahead). */
  let warnedFor: string | null = null;
  /** Why the draft couldn't be sent (cleared by the next edit). */
  const [problem, setProblem] = createSignal("");
  const [draft, setDraft] = createSignal<Draft>({ kind: "new", id: null, account: accounts()[0]?.id ?? "", to: "", subject: "", body: "" });
  /** Where Escape goes back to from a search. */
  let beforeSearch: Mailbox = { kind: "all" };
  const history: { messages: Message[]; selectedId: number | null }[] = [];

  const list = createMemo(() => {
    const m = mailbox();
    return messages()
      .filter((msg) => inMailbox(msg, m) && (!usesTabs(m) || (tab() === "important") === msg.important))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  });
  const selected = createMemo(() => list().find((m) => m.id === selectedId()) ?? list()[0] ?? null);

  /** Messages per conversation, trash and drafts left out. */
  const threadSizes = createMemo(() => {
    const sizes = new Map<number | string, number>();
    for (const m of messages()) if (m.folder !== "trash" && m.folder !== "drafts") sizes.set(threadOf(m), (sizes.get(threadOf(m)) ?? 0) + 1);
    return sizes;
  });
  /** The selected message's conversation, oldest first (trash and drafts left out, unless that's where the selection is). */
  const conversation = createMemo(() => {
    const s = selected();
    if (!s) return [];
    return messages()
      .filter((m) => threadOf(m) === threadOf(s) && ((m.folder !== "trash" && m.folder !== "drafts") || m.id === s.id))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  const unread = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m) && msg.unread).length;
  const count = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m)).length;
  const unreadInTab = (t: Tab) => messages().filter((msg) => inMailbox(msg, mailbox()) && (t === "important") === msg.important && msg.unread).length;
  const threadSize = (msg: Message) => threadSizes().get(threadOf(msg)) ?? 1;
  /** Everyone who has written to you, for names in the To line. */
  const contacts = createMemo(() => {
    const seen = new Map<string, Contact>();
    for (const m of messages()) for (const c of [m.from, ...(m.to ?? []), ...(m.cc ?? []), ...(m.bcc ?? [])]) if (!isMine(c) && c.email) seen.set(c.email.toLowerCase(), c);
    return [...seen.values()];
  });
  const nextId = () => Math.max(0, ...messages().map((m) => m.id)) + 1;

  /** Changes messages; the previous state goes on the undo stack. */
  function change(fn: (ms: Message[]) => Message[], message: string) {
    history.push({ messages: messages(), selectedId: selected()?.id ?? null });
    if (history.length > 50) history.shift();
    setMessages(fn(messages()));
    setStatus(message, true);
  }
  const patch = (id: number, p: Partial<Message>) => (ms: Message[]) => ms.map((m) => (m.id === id ? { ...m, ...p } : m));

  /** The message after (or else before) the selected one, to select once it leaves the list. */
  function neighbour(): number | null {
    const l = list(), s = selected();
    if (!s) return null;
    const i = l.indexOf(s);
    return (l[i + 1] ?? l[i - 1])?.id ?? null;
  }

  /** Changes a message without an undo step or an onChange (the outbox after sending). */
  const patchQuiet = (id: number, p: Partial<Message>) => setMessagesRaw(messages().map((m) => (m.id === id ? { ...m, ...p } : m)));

  /** A draft's To, Cc and Bcc, parsed. */
  const recipientsOf = (d: Draft) => {
    const [to, cc, bcc] = [d.to, d.cc ?? "", d.bcc ?? ""].map((t) => parseRecipients(t, contacts()));
    return { to: to.ok, cc: cc.ok, bcc: bcc.ok, bad: [...to.bad, ...cc.bad, ...bcc.bad] };
  };
  /** The draft's address lines as kept with a saved message. */
  const linesOf = (d: Draft) => ({ to: d.to, ...(d.cc ? { cc: d.cc } : {}), ...(d.bcc ? { bcc: d.bcc } : {}), replyTo: d.replyTo });
  /** Who a reply to `s` goes to: the sender (or, for your own message, its recipients), and with `all` everyone else on it in Cc. */
  function replyRecipients(s: Message, all: boolean) {
    const same = (a: Contact, b: Contact) => a.email.toLowerCase() === b.email.toLowerCase();
    const to = isMine(s.from) ? (s.to?.length ? s.to : [s.from]) : [s.from];
    const others = dedupe([...(s.to ?? []), ...(s.cc ?? [])]).filter((c) => !isMine(c) && !to.some((t) => same(t, c)));
    return { to: formatContacts(to), cc: all ? formatContacts(others) : "", others };
  }
  /** Turns the reply being written into a Reply All, or back to the sender only; the text stays. */
  function setReplyAll(all: boolean) {
    const s = selected(), d = draft();
    if (!s || panel() !== "reply" || d.replyTo !== s.id) return;
    const r = replyRecipients(s, all);
    batch(() => {
      setDraft({ ...d, to: r.to, cc: r.cc });
      setReplyingAll(all);
    });
  }
  /** Whether the draft has anything the user typed (a reply's To and Subject come filled in). */
  const typed = (d: Draft) => !!d.body.trim() || !!d.attachments?.length || (d.kind === "new" && !!(d.to.trim() || d.cc?.trim() || d.bcc?.trim() || d.subject.trim()));

  /** Keeps the draft in Drafts (or drops its saved copy when it's empty). Not an undo step. */
  function saveDraft(): boolean {
    const d = draft();
    if (!typed(d)) {
      if (d.id !== null) setMessages(messages().filter((m) => m.id !== d.id));
      return false;
    }
    const original = d.replyTo === undefined ? undefined : messages().find((m) => m.id === d.replyTo);
    const id = d.id ?? nextId();
    const r = recipientsOf(d);
    // A real account's draft keeps one Message-ID through its edits: the copy on the server is found by it.
    const messageId = messages().find((m) => m.id === id)?.messageId ?? (accountOf(d.account)?.sample ? undefined : `${crypto.randomUUID()}@${fromAccount(d.account).email.split("@")[1] ?? "mantou.mail"}`);
    const saved: Message = {
      id, account: d.account, folder: "drafts", from: fromAccount(d.account),
      to: r.to, ...(r.cc.length ? { cc: r.cc } : {}), ...(r.bcc.length ? { bcc: r.bcc } : {}),
      subject: d.subject, body: paragraphs(d.body), date: now(),
      unread: false, starred: false, important: true, labels: [],
      thread: original ? threadOf(original) : undefined, draft: linesOf(d), attachments: d.attachments?.length ? d.attachments : undefined,
      ...(messageId ? { messageId } : {}),
    };
    setMessages(d.id === null ? [...messages(), saved] : messages().map((m) => (m.id === id ? saved : m)));
    setDraft({ ...d, id });
    return true;
  }
  /** Closes the panel under the reader; a reply in progress is kept as a draft. */
  function closePanel() {
    batch(() => {
      if (panel() === "reply" && saveDraft()) setStatus("Draft saved");
      setPanel(null);
    });
  }
  /** Opens the new-message composer: blank, or with a saved draft. */
  function compose(from?: Message) {
    if (composing()) return;
    const box = mailbox();
    batch(() => {
      closePanel();
      setDraft(from?.folder === "drafts" ? draftFrom(from) : {
        kind: "new", id: null, to: "", subject: "", body: "",
        account: box.kind === "account" ? box.id : (selected()?.account ?? accounts()[0]?.id ?? ""),
      });
      setProblem("");
      setComposing(true);
    });
  }
  function draftFrom(msg: Message): Draft {
    return {
      kind: msg.draft?.replyTo === undefined ? "new" : "reply", id: msg.id, account: msg.account,
      to: msg.draft?.to ?? formatContacts(msg.to ?? []), cc: msg.draft?.cc ?? formatContacts(msg.cc ?? []), bcc: msg.draft?.bcc ?? formatContacts(msg.bcc ?? []), subject: msg.subject, body: msg.body.join("\n\n"), replyTo: msg.draft?.replyTo, attachments: msg.attachments,
    };
  }

  function select(id: number) {
    batch(() => {
      closePanel();
      setSelectedId(id);
      if (messages().find((m) => m.id === id)?.unread) setMessages(patch(id, { unread: false })(messages()));
    });
  }
  /** Changes the selected message in a way that takes it out of the list, and selects its neighbour. */
  function leave(fn: (s: Message) => (ms: Message[]) => Message[], status: (s: Message) => string) {
    const s = selected();
    if (!s) return;
    const next = neighbour();
    batch(() => {
      change(fn(s), status(s));
      setSelectedId(null);
      if (next !== null) select(next); // opening the next message marks it read, as opening any does
      closePanel();
    });
  }
  const file = (folder: Folder, verb: string, extra: Partial<Message> = {}) =>
    leave((s) => patch(s.id, { folder, ...extra }), (s) => `${verb} “${s.subject}”`);

  function open(m: Mailbox) {
    batch(() => {
      closePanel();
      setMailbox(m);
      setSelectedId(null);
    });
  }
  function setQuery(query: string) {
    batch(() => {
      setMailbox({ kind: "search", query });
      setSelectedId(null);
    });
  }
  const query = () => {
    const m = mailbox();
    return m.kind === "search" ? m.query : "";
  };

  return {
    messages, list, selected, mailbox, tab, panel, status, searching, conversation, composing, draft, contacts, problem, undoable,
    accounts, accountOf, isMine, nextId,
    /** Shows why the draft can't go yet, beside Send (cleared by the next edit). */
    showProblem: (text: string) => setProblem(text),
    mailboxName: (box: Mailbox) => mailboxName(box, accounts()),
    /** Shows a status line that isn't an undo step (sync progress, errors). */
    note: (text: string) => setStatus(text),
    /**
     * Messages of an account as the server has them now. They replace that
     * account's server messages; this isn't an undo step and isn't sent back.
     */
    receive(account: string, list: Message[]) {
      // A message sent from here is replaced by the server's copy once it's in Sent there.
      const arrived = new Set(list.map((m) => m.messageId).filter(Boolean));
      setMessagesRaw([...messages().filter((m) => (m.account !== account || !m.remote) && !(m.messageId && !m.outbox && !m.remote && arrived.has(m.messageId))), ...list]);
    },
    patchQuiet,
    /** A message that couldn't be sent goes back to Drafts, to fix and send again. */
    backToDrafts(id: number) {
      const m = messages().find((x) => x.id === id);
      if (!m) return;
      patchQuiet(id, { folder: "drafts", outbox: undefined, draft: { to: formatContacts(m.to ?? []), cc: formatContacts(m.cc ?? []), bcc: formatContacts(m.bcc ?? []), replyTo: m.outbox?.replyTo } });
    },
    /**
     * Sets the accounts, and the messages to show for them (default: the ones
     * already here). Not an undo step; switching from sample mail to real
     * accounts and back goes through here.
     */
    setAccounts(list: Account[], with_?: Message[]) {
      const ids = new Set(list.map((a) => a.id));
      batch(() => {
        setAccountsRaw(list);
        setMessagesRaw((with_ ?? messages()).filter((m) => ids.has(m.account)));
        history.length = 0;
        if (mailbox().kind === "account" && !ids.has((mailbox() as { id: string }).id)) open({ kind: "all" });
        if (!ids.has(draft().account)) setDraft({ ...draft(), account: list[0]?.id ?? "" });
      });
    },
    unread, count, unreadInTab, threadSize, select, open, closePanel,
    replying: () => panel() === "reply",

    move(delta: number) {
      const l = list(), s = selected();
      if (!l.length) return;
      const i = s ? l.indexOf(s) : -1;
      select(l[Math.max(0, Math.min(l.length - 1, i + delta))].id);
    },
    setTab(t: Tab) {
      batch(() => {
        closePanel();
        setTab(t);
        setSelectedId(null);
      });
    },
    archive: () => file("archive", "Archived", { unread: false }),
    /** Deletes the message: to the trash, or for good from the trash (undo still brings it back). */
    remove() {
      if (selected()?.folder === "trash") leave((s) => (ms) => ms.filter((m) => m.id !== s.id), () => "Deleted forever");
      else if (selected()?.folder === "scheduled") file("trash", "Cancelled and deleted", { outbox: undefined });
      else file("trash", "Deleted", { unread: false });
    },
    moveToInbox() {
      if (selected() && isFiledAway(selected()!)) file("inbox", "Moved to Inbox", { snoozedUntil: undefined });
    },
    snooze(i: number) {
      const o = SNOOZE_OPTIONS[i];
      if (o) leave((s) => patch(s.id, { folder: "snoozed", snoozedUntil: o.until, unread: false }), () => `Snoozed until ${o.until}`);
    },
    toggleLabel(id: string) {
      const s = selected(), l = LABELS.find((x) => x.id === id);
      if (!s || !l) return;
      const has = s.labels.includes(id);
      change(patch(s.id, { labels: has ? s.labels.filter((x) => x !== id) : [...s.labels, id] }), `${has ? "Removed" : "Added"} label ${l.name}`);
    },
    star() {
      const s = selected();
      if (s) change(patch(s.id, { starred: !s.starred }), s.starred ? "Unstarred" : "Starred");
    },
    toggleUnread() {
      const s = selected();
      if (s) change(patch(s.id, { unread: !s.unread }), s.unread ? "Marked as read" : "Marked as unread");
    },
    /** Opens a panel, or closes it if it's open. */
    togglePanel(p: Exclude<Panel, null>) {
      if (!selected()) return;
      if (panel() === p) return closePanel();
      batch(() => {
        closePanel();
        setPanel(p);
      });
    },
    /**
     * Opens the reply composer for the selected message, with its saved draft
     * if there is one; `all` replies to everyone on it (the others in Cc).
     * Pressed again, the same kind of reply closes it.
     */
    toggleReply(all = false) {
      const s = selected();
      if (!s) return;
      if (panel() === "reply") return replyingAll() === all ? closePanel() : setReplyAll(all);
      if (s.folder === "drafts") return compose(s);
      const saved = messages().find((m) => m.folder === "drafts" && m.draft?.replyTo === s.id);
      const r = replyRecipients(s, all);
      batch(() => {
        closePanel();
        const base: Draft = saved ? draftFrom(saved) : { kind: "reply", id: null, account: s.account, replyTo: s.id, to: r.to, cc: r.cc, subject: reSubject(s.subject), body: "" };
        setDraft(all && !base.cc?.trim() ? { ...base, cc: r.cc } : base);
        setReplyingAll(all || !!draft().cc?.trim()); // a saved reply with copies is a Reply All
        setProblem("");
        setPanel("reply");
      });
    },
    /** Whether the reply composer is a Reply All. */
    replyingAll,
    /** The people a Reply All adds (none: there's no one else on the message). */
    othersOnReply: () => {
      const s = selected();
      return s ? replyRecipients(s, true).others : [];
    },
    /** Turns the reply being written into a Reply All, or back to the sender only; the text stays. */
    setReplyAll,

    // Composing: the draft is edited field by field, then sent or kept in Drafts.
    compose,
    editDraft(p: Partial<Pick<Draft, "account" | "to" | "cc" | "bcc" | "subject" | "body">>) {
      batch(() => {
        setDraft({ ...draft(), ...p });
        setProblem("");
      });
    },
    addAttachments(list: Attachment[]) {
      batch(() => {
        setDraft({ ...draft(), attachments: [...(draft().attachments ?? []), ...list] });
        setProblem("");
      });
    },
    removeAttachment(i: number) {
      setDraft({ ...draft(), attachments: (draft().attachments ?? []).filter((_, j) => j !== i) });
    },
    /** Forwards the selected message: a new draft with its text quoted and its attachments. */
    forward() {
      const s = selected();
      if (!s || composing()) return;
      const who = (c: Contact) => (c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email);
      const quoted = [
        "---------- Forwarded message ----------",
        `From: ${who(s.from)}`,
        `Date: ${longDate(s.date)}`,
        `Subject: ${s.subject}`,
        ...(s.to?.length ? [`To: ${s.to.map(who).join(", ")}`] : []),
        ...(s.cc?.length ? [`Cc: ${s.cc.map(who).join(", ")}`] : []),
      ].join("\n");
      batch(() => {
        closePanel();
        setDraft({
          kind: "new", id: null, account: s.account, to: "",
          subject: /^fwd?:/i.test(s.subject) ? s.subject : `Fwd: ${s.subject}`,
          body: `\n\n${quoted}\n\n${s.body.join("\n\n")}`,
          // Forwarded files still on the server are fetched when it's sent (`from` is where they are).
          attachments: (s.attachments ?? []).map((a) => ({ ...a, from: s.id })),
        });
        setProblem("");
        setComposing(true);
      });
    },
    /** A quick reply as a starting point: added to the body. */
    insertReply(text: string) {
      const body = draft().body.trimEnd();
      setDraft({ ...draft(), body: body ? `${body}\n\n${text}` : text });
    },
    /** Closes the new-message composer, keeping what was typed in Drafts. */
    closeCompose() {
      batch(() => {
        if (saveDraft()) setStatus("Draft saved");
        setComposing(false);
      });
    },
    /** Throws the draft away (undo brings a saved one back). */
    discard() {
      const d = draft();
      batch(() => {
        if (d.id !== null) change((ms) => ms.filter((m) => m.id !== d.id), "Draft discarded");
        else setStatus("Draft discarded");
        setDraft({ ...d, id: null, to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] });
        setComposing(false);
        setPanel(null);
      });
    },
    /** Sends the draft; false (and why, in the status) if it can't go yet. */
    /** Sends the draft, now (after Undo Send) or, with `at`, then (Send Later); false, with the reason, if it can't go. */
    send(at?: Date): boolean {
      const d = draft();
      const r = recipientsOf(d);
      if (r.bad.length) return setProblem(`“${r.bad[0]}” isn't an email address`), false;
      if (!r.to.length && !r.cc.length && !r.bcc.length) return setProblem("Add a recipient first"), false;
      const everyone = dedupe([...r.to, ...r.cc, ...r.bcc]);
      if (!d.body.trim() && !d.subject.trim() && !d.attachments?.length) return setProblem("Write something first"), false;
      // Said "attached" with nothing attached: warn once; Send again sends it as it is.
      if (!d.attachments?.length && mentionsAttachment(d.body) && warnedFor !== d.body) {
        warnedFor = d.body;
        return setProblem("It says “attached”, but nothing is. Attach it, or Send again to send it as it is"), false;
      }
      const bytes = (d.attachments ?? []).reduce((n, a) => n + a.size, 0);
      if (bytes > MAX_SEND) return setProblem(`Attachments over 25 MB usually bounce (these are ${(bytes / 1e6).toFixed(0)} MB)`), false;
      const original = d.replyTo === undefined ? undefined : messages().find((m) => m.id === d.replyTo);
      const from = fromAccount(d.account);
      // A real account's message waits in the outbox (Undo Send), then goes over SMTP (src/mail/remote.ts).
      const real = !accountOf(d.account)?.sample;
      // Saved first, so that undoing the send puts the text back in Drafts (and before the sent
      // message takes the next id, so the two don't share one).
      saveDraft();
      const saved = draft().id;
      const later = at && at.getTime() > now().getTime() ? at : undefined;
      const sent: Message = {
        id: nextId(), account: d.account, folder: later ? "scheduled" : "sent", from,
        to: r.to, ...(r.cc.length ? { cc: r.cc } : {}), ...(r.bcc.length ? { bcc: r.bcc } : {}),
        subject: d.subject.trim() || "(no subject)", body: paragraphs(d.body), date: later ?? now(),
        unread: false, starred: false, important: true, labels: [], thread: original ? threadOf(original) : undefined,
        attachments: d.attachments?.length ? d.attachments : undefined,
        ...(real ? { messageId: `${crypto.randomUUID()}@${from.email.split("@")[1] ?? "mantou.mail"}` } : {}),
        // A real account's mail goes through the outbox; sample mail only when it's scheduled (deliverDue sends it).
        ...(real || later ? { outbox: { replyTo: original?.id, ...(later ? { at: later.toISOString() } : {}) } } : {}),
      };
      batch(() => {
        change((ms) => {
          let out = ms.filter((m) => m.id !== saved);
          if (original) out = patch(original.id, { waitingSince: now() })(out);
          return [...out, sent];
        }, later ? `Scheduled for ${longDate(later)}` : `${real ? "Sending" : "Sent"} to ${names(everyone)}`);
        setDraft({ ...d, id: null, to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] });
        setComposing(false);
        setPanel(null);
      });
      return true;
    },
    /** A scheduled message goes now (after the Undo Send delay, for a real account). */
    sendNow() {
      const s = selected();
      if (s?.folder !== "scheduled" || !s.outbox) return;
      const real = !accountOf(s.account)?.sample;
      if (real) change(patch(s.id, { folder: "sent", date: now(), outbox: { replyTo: s.outbox.replyTo } }), `Sending to ${names(recipients(s))}`);
      else change(patch(s.id, { folder: "sent", date: now(), outbox: undefined }), `Sent to ${names(recipients(s))}`);
    },
    /** A scheduled message back to Drafts, unscheduled, to change it. */
    editScheduled() {
      const s = selected();
      if (s?.folder !== "scheduled") return;
      const back = { ...s, folder: "drafts" as const, outbox: undefined, date: now(), draft: { to: formatContacts(s.to ?? []), cc: formatContacts(s.cc ?? []), bcc: formatContacts(s.bcc ?? []), replyTo: s.outbox?.replyTo } };
      batch(() => {
        change((ms) => ms.map((m) => (m.id === s.id ? back : m)), "Unscheduled: it's in Drafts");
        compose(back);
      });
    },
    /**
     * Sample mail that was scheduled and is due: it's sent (a real account's is
     * sent by src/mail/remote.ts). The app calls this every half minute.
     */
    deliverDue(at = now()) {
      for (const m of messages()) {
        if (m.folder !== "scheduled" || !m.outbox?.at || !accountOf(m.account)?.sample) continue;
        if (Date.parse(m.outbox.at) > at.getTime()) continue;
        patchQuiet(m.id, { folder: "sent", outbox: undefined, date: new Date(m.outbox.at) });
        setStatus(`Sent the scheduled message to ${names(recipients(m))}`);
      }
    },
    undo() {
      const prev = history.pop();
      if (!prev) return setStatus("Nothing to undo");
      batch(() => {
        setMessages(prev.messages);
        setSelectedId(prev.selectedId);
        setStatus("Undone");
      });
    },

    // Search: the search field's focus and text drive these.
    query,
    setQuery,
    /** The search field got the focus: results replace the mailbox (empty until something is typed). */
    startSearch() {
      batch(() => {
        if (mailbox().kind !== "search") {
          beforeSearch = mailbox();
          closePanel();
          setQuery("");
        }
        setSearching(true);
      });
    },
    /** The search field lost the focus: with nothing typed, back to where the search started. */
    endSearch() {
      batch(() => {
        setSearching(false);
        if (mailbox().kind === "search" && !query().trim()) open(beforeSearch);
      });
    },
    /** Escape: back to where the search started. */
    cancelSearch: () => open(beforeSearch),
  };
}

export type Mail = ReturnType<typeof createMail>;
