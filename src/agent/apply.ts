// A proposal, carried out: the same changes the person makes by hand, nothing more. Only mail in the Inbox,
// Archive or Snoozed is touched: Sent, Drafts, Scheduled and Trash are never changed by a proposal.
import { longDate, type Message } from "../data";
import type { Proposal } from "./proposals";

const WORKING = new Set(["inbox", "archive", "snoozed"]);

/** The messages after the proposal, and the ids that changed (none when it no longer applies). */
export function applyProposal(ms: Message[], p: Proposal, labelId: (name: string) => string | undefined): { messages: Message[]; changed: number[] } {
  const ids = new Set(p.ids);
  const changed: number[] = [];
  const edit = (m: Message): Message | null => {
    switch (p.kind) {
      case "archive": return m.folder === "inbox" ? { ...m, folder: "archive", unread: false } : null;
      case "moveToInbox": return m.folder === "archive" || m.folder === "snoozed" ? { ...m, folder: "inbox", snoozedUntil: undefined } : null;
      case "markRead": return m.unread ? { ...m, unread: false } : null;
      case "label": {
        const id = p.value ? labelId(p.value) : undefined;
        return id && !m.labels.includes(id) ? { ...m, labels: [...m.labels, id] } : null;
      }
      case "snooze": return m.folder === "inbox" && p.value && !Number.isNaN(Date.parse(p.value)) ? { ...m, folder: "snoozed", snoozedUntil: longDate(new Date(p.value)), unread: false } : null;
    }
  };
  const messages = ms.map((m) => {
    if (!ids.has(m.id) || !WORKING.has(m.folder)) return m;
    const next = edit(m);
    if (!next) return m;
    changed.push(m.id);
    return next;
  });
  return { messages, changed };
}

/** What approving says in the status line. */
export const describe = (p: Proposal, n: number): string => {
  const what = n === 1 ? "1 conversation" : `${n} conversations`;
  switch (p.kind) {
    case "archive": return `Archived ${what}`;
    case "moveToInbox": return `Moved ${what} to Inbox`;
    case "markRead": return `Marked ${what} as read`;
    case "label": return `Labelled ${what} ${p.value}`;
    case "snooze": return `Snoozed ${what}`;
  }
};
