// Mantou Mail's state: Solid signals and the actions the UI and the keyboard
// share. Nothing here knows about views.
import { batch, createMemo, createSignal } from "mantou-ui";
import { ACCOUNTS, LABELS, ME, NOW, sampleMessages, threadOf, type Contact, type Folder, type Message } from "./data";

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

export function mailboxName(m: Mailbox): string {
  switch (m.kind) {
    case "all": return "All inboxes";
    case "account": return ACCOUNTS.find((a) => a.id === m.id)?.name ?? m.id;
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
  subject: string;
  body: string;
  replyTo?: number;
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

export const formatContacts = (cs: Contact[]) => cs.map((c) => (c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email)).join(", ");

/** A body as typed, as the message's paragraphs (split at blank lines). */
export const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

const reSubject = (subject: string) => (subject.startsWith("Re: ") ? subject : `Re: ${subject}`);

export function createMail(initial: Message[] = sampleMessages()) {
  const [messages, setMessages] = createSignal(initial);
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
  /** Why the draft couldn't be sent (cleared by the next edit). */
  const [problem, setProblem] = createSignal("");
  const [draft, setDraft] = createSignal<Draft>({ kind: "new", id: null, account: ACCOUNTS[0].id, to: "", subject: "", body: "" });
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
    const sizes = new Map<number, number>();
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
    for (const m of messages()) for (const c of [m.from, ...(m.to ?? [])]) if (c.name !== ME) seen.set(c.email.toLowerCase(), c);
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

  /** Whether the draft has anything the user typed (a reply's To and Subject come filled in). */
  const typed = (d: Draft) => !!d.body.trim() || (d.kind === "new" && !!(d.to.trim() || d.subject.trim()));

  /** Keeps the draft in Drafts (or drops its saved copy when it's empty). Not an undo step. */
  function saveDraft(): boolean {
    const d = draft();
    if (!typed(d)) {
      if (d.id !== null) setMessages(messages().filter((m) => m.id !== d.id));
      return false;
    }
    const account = ACCOUNTS.find((a) => a.id === d.account)!;
    const original = d.replyTo === undefined ? undefined : messages().find((m) => m.id === d.replyTo);
    const id = d.id ?? nextId();
    const saved: Message = {
      id, account: d.account, folder: "drafts", from: { name: ME, email: account.email },
      to: parseRecipients(d.to, contacts()).ok, subject: d.subject, body: paragraphs(d.body), date: NOW,
      unread: false, starred: false, important: true, labels: [],
      thread: original ? threadOf(original) : undefined, draft: { to: d.to, replyTo: d.replyTo },
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
        account: box.kind === "account" ? box.id : (selected()?.account ?? ACCOUNTS[0].id),
      });
      setProblem("");
      setComposing(true);
    });
  }
  function draftFrom(msg: Message): Draft {
    return {
      kind: msg.draft?.replyTo === undefined ? "new" : "reply", id: msg.id, account: msg.account,
      to: msg.draft?.to ?? formatContacts(msg.to ?? []), subject: msg.subject, body: msg.body.join("\n\n"), replyTo: msg.draft?.replyTo,
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
    /** Opens the reply composer for the selected message, with its saved draft if there is one. */
    toggleReply() {
      const s = selected();
      if (!s) return;
      if (panel() === "reply") return closePanel();
      if (s.folder === "drafts") return compose(s);
      const saved = messages().find((m) => m.folder === "drafts" && m.draft?.replyTo === s.id);
      batch(() => {
        closePanel();
        setDraft(saved ? draftFrom(saved) : {
          kind: "reply", id: null, account: s.account, replyTo: s.id,
          to: formatContacts([s.from.name === ME ? (s.to?.[0] ?? s.from) : s.from]), subject: reSubject(s.subject), body: "",
        });
        setProblem("");
        setPanel("reply");
      });
    },

    // Composing: the draft is edited field by field, then sent or kept in Drafts.
    compose,
    editDraft(p: Partial<Pick<Draft, "account" | "to" | "subject" | "body">>) {
      batch(() => {
        setDraft({ ...draft(), ...p });
        setProblem("");
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
        setDraft({ ...d, id: null, to: "", subject: "", body: "" });
        setComposing(false);
        setPanel(null);
      });
    },
    /** Sends the draft; false (and why, in the status) if it can't go yet. */
    send(): boolean {
      const d = draft();
      const { ok, bad } = parseRecipients(d.to, contacts());
      if (bad.length) return setProblem(`“${bad[0]}” isn't an email address`), false;
      if (!ok.length) return setProblem("Add a recipient first"), false;
      if (!d.body.trim() && !d.subject.trim()) return setProblem("Write something first"), false;
      const account = ACCOUNTS.find((a) => a.id === d.account)!;
      const original = d.replyTo === undefined ? undefined : messages().find((m) => m.id === d.replyTo);
      const sent: Message = {
        id: nextId(), account: d.account, folder: "sent", from: { name: ME, email: account.email }, to: ok,
        subject: d.subject.trim() || "(no subject)", body: paragraphs(d.body), date: NOW,
        unread: false, starred: false, important: true, labels: [], thread: original ? threadOf(original) : undefined,
      };
      batch(() => {
        change((ms) => {
          let out = ms.filter((m) => m.id !== d.id);
          if (original) out = patch(original.id, { waitingSince: NOW })(out);
          return [...out, sent];
        }, `Sent to ${ok.map((c) => c.name).join(", ")}`);
        setDraft({ ...d, id: null, to: "", subject: "", body: "" });
        setComposing(false);
        setPanel(null);
      });
      return true;
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
