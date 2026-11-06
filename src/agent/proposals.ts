// What the agent may write: proposals. It can't change mail itself; a proposal becomes an action
// when the person approves it (or, later, under a standing rule), and every action is logged with its inverse.

/** Reversible organising only: there is no kind that sends, deletes or leaves the machine. */
export const PROPOSAL_KINDS = ["archive", "moveToInbox", "markRead", "label", "snooze"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface Proposal {
  id: number;
  kind: ProposalKind;
  /** The messages it applies to. */
  ids: number[];
  /** Why, in the agent's words (shown to the person, and kept in the log). */
  reason: string;
  /** For "label": the label's name; for "snooze": when it comes back (ISO time). */
  value?: string;
  status: "pending" | "approved" | "dismissed";
  createdAt: Date;
}

export interface LogEntry {
  id: number;
  at: Date;
  /** Who did it. */
  actor: "user" | "agent" | "rule";
  /** The proposal it came from. */
  proposal?: number;
  action: string;
  ids: number[];
  reason: string;
}
