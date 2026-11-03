// Mantou Mail's state: Solid signals and the actions the UI and the keyboard
// share. Nothing here knows about views.
import { batch, createMemo, createSignal } from "mantou-ui";
import { ACCOUNTS, LABELS, ME, NOW, sampleMessages, threadOf, type Folder, type Message } from "./data";

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

/** The panel under the reader: quick replies, snooze times, or labels. */
export type Panel = "reply" | "snooze" | "labels" | null;

export function createMail(initial: Message[] = sampleMessages()) {
  const [messages, setMessages] = createSignal(initial);
  const [mailbox, setMailbox] = createSignal<Mailbox>({ kind: "all" });
  const [tab, setTab] = createSignal<Tab>("important");
  const [selectedId, setSelectedId] = createSignal<number | null>(null);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [status, setStatus] = createSignal("");
  /** Keys go to the search query (rather than triage) while this is on. */
  const [searching, setSearching] = createSignal(false);
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

  /** Messages per conversation, trash left out. */
  const threadSizes = createMemo(() => {
    const sizes = new Map<number, number>();
    for (const m of messages()) if (m.folder !== "trash") sizes.set(threadOf(m), (sizes.get(threadOf(m)) ?? 0) + 1);
    return sizes;
  });
  /** The selected message's conversation, oldest first (trash left out, unless that's where the selection is). */
  const conversation = createMemo(() => {
    const s = selected();
    if (!s) return [];
    return messages()
      .filter((m) => threadOf(m) === threadOf(s) && (m.folder !== "trash" || m.id === s.id))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  const unread = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m) && msg.unread).length;
  const count = (m: Mailbox) => messages().filter((msg) => inMailbox(msg, m)).length;
  const unreadInTab = (t: Tab) => messages().filter((msg) => inMailbox(msg, mailbox()) && (t === "important") === msg.important && msg.unread).length;
  const threadSize = (msg: Message) => threadSizes().get(threadOf(msg)) ?? 1;

  /** Changes messages; the previous state goes on the undo stack. */
  function change(fn: (ms: Message[]) => Message[], message: string) {
    history.push({ messages: messages(), selectedId: selected()?.id ?? null });
    if (history.length > 50) history.shift();
    setMessages(fn(messages()));
    setStatus(message);
  }
  const patch = (id: number, p: Partial<Message>) => (ms: Message[]) => ms.map((m) => (m.id === id ? { ...m, ...p } : m));

  /** The message after (or else before) the selected one, to select once it leaves the list. */
  function neighbour(): number | null {
    const l = list(), s = selected();
    if (!s) return null;
    const i = l.indexOf(s);
    return (l[i + 1] ?? l[i - 1])?.id ?? null;
  }

  function select(id: number) {
    batch(() => {
      setSelectedId(id);
      setPanel(null);
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
      setPanel(null);
    });
  }
  const file = (folder: Folder, verb: string, extra: Partial<Message> = {}) =>
    leave((s) => patch(s.id, { folder, ...extra }), (s) => `${verb} “${s.subject}”`);

  function open(m: Mailbox) {
    batch(() => {
      setMailbox(m);
      setSelectedId(null);
      setPanel(null);
      setSearching(false);
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
    messages, list, selected, mailbox, tab, panel, status, searching, conversation,
    unread, count, unreadInTab, threadSize, select, open,
    replying: () => panel() === "reply",

    move(delta: number) {
      const l = list(), s = selected();
      if (!l.length) return;
      const i = s ? l.indexOf(s) : -1;
      select(l[Math.max(0, Math.min(l.length - 1, i + delta))].id);
    },
    setTab(t: Tab) {
      batch(() => {
        setTab(t);
        setSelectedId(null);
        setPanel(null);
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
      if (selected()) setPanel(panel() === p ? null : p);
    },
    closePanel: () => setPanel(null),
    toggleReply() {
      if (selected()) setPanel(panel() === "reply" ? null : "reply");
    },
    reply(text: string) {
      const s = selected();
      if (!s) return;
      const account = ACCOUNTS.find((a) => a.id === s.account)!;
      const sent: Message = {
        id: Math.max(...messages().map((m) => m.id)) + 1,
        account: s.account,
        folder: "sent",
        from: { name: ME, email: account.email },
        subject: s.subject.startsWith("Re: ") ? s.subject : `Re: ${s.subject}`,
        body: [text],
        date: NOW,
        unread: false,
        starred: false,
        important: true,
        labels: [],
        thread: threadOf(s),
      };
      batch(() => {
        change((ms) => [...patch(s.id, { waitingSince: NOW })(ms), sent], `Reply sent to ${s.from.name}`);
        setPanel(null);
      });
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

    // Search: the query is typed with the keyboard while `searching` is on.
    query,
    startSearch() {
      batch(() => {
        if (mailbox().kind !== "search") {
          beforeSearch = mailbox();
          setQuery("");
        }
        setPanel(null);
        setSearching(true);
      });
    },
    type(text: string) {
      setQuery(query() + text);
    },
    backspace() {
      setQuery(query().slice(0, -1));
    },
    /** Enter: keys go back to triage, the results stay (an empty query goes back). */
    submitSearch() {
      if (!query().trim()) return open(beforeSearch);
      setSearching(false);
    },
    /** Escape: back to where the search started. */
    cancelSearch: () => open(beforeSearch),
  };
}

export type Mail = ReturnType<typeof createMail>;
