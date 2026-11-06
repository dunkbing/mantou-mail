// The Queue: the agent's proposals, approved or dismissed by the person, carried out as if by hand.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { applyProposal } from "../src/agent/apply";
import type { Proposal } from "../src/agent/proposals";
import { sampleMessages } from "../src/data";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { createMail, type Mail } from "../src/state";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const proposal = (over: Partial<Proposal> & Pick<Proposal, "id" | "kind" | "ids">): Proposal => ({ reason: "Because", status: "pending", createdAt: new Date("2026-11-06T09:00:00Z"), ...over });
const texts = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isText).map((n) => n.textContent);
const text = (h: HeadlessCore, content: string): Node => [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === content)!;

function app(proposals: Proposal[], decided: [number, string, number[]][] = []) {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  let mail!: Mail;
  mount(h.ui, () => {
    mail = createMail(sampleMessages(), { proposals, onDecide: (p, status, changed) => void decided.push([p.id, status, changed]) });
    return <App mail={mail} />;
  });
  h.step();
  return { h, mail };
}

const inbox = () => sampleMessages().filter((m) => m.folder === "inbox").map((m) => m.id);

test("the Queue lists what the agent proposed, with why; approving does it, and undo takes it back", () => {
  const ids = inbox().slice(0, 2);
  const decided: [number, string, number[]][] = [];
  const { h, mail } = app([proposal({ id: 7, kind: "archive", ids, reason: "You've read these receipts" })], decided);
  h.press(text(h, "Queue"));
  expect(texts(h)).toContain("You've read these receipts");
  expect(texts(h).some((t) => t.startsWith("Archive · 2 conversations"))).toBe(true);
  h.press(text(h, "Approve"));
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.folder === "archive")).toBe(true);
  expect(mail.status()).toBe("Archived 2 conversations: You've read these receipts");
  expect(decided).toEqual([[7, "approved", ids]]);
  expect(texts(h)).toContain("Nothing waiting");
  mail.undo();
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.folder === "inbox")).toBe(true);
});

test("Dismiss changes no mail; Enter approves the first proposal and X dismisses it", () => {
  const [a, b, c] = inbox();
  const { h, mail } = app([proposal({ id: 1, kind: "archive", ids: [a] }), proposal({ id: 2, kind: "markRead", ids: [b] }), proposal({ id: 3, kind: "archive", ids: [c] })]);
  h.press(text(h, "Queue"));
  h.key("x"); // dismisses #1
  expect(mail.messages().find((m) => m.id === a)!.folder).toBe("inbox");
  expect(mail.proposals().map((p) => p.id)).toEqual([2, 3]);
  h.key("Enter"); // approves #2 (mark as read)
  expect(mail.proposals().map((p) => p.id)).toEqual([3]);
  expect(mail.messages().find((m) => m.id === b)!.unread).toBe(false);
});

test("a proposal never touches mail outside Inbox, Archive and Snoozed, and does nothing for an unknown label", () => {
  const ms = sampleMessages().map((m, i) => (i === 0 ? { ...m, folder: "trash" as const } : m));
  const sent = ms.find((m) => m.folder === "sent")!;
  const trashed = ms[0];
  const [first] = ms.filter((m) => m.folder === "inbox").map((m) => m.id);
  const ids = [sent.id, trashed.id, first];
  const r = applyProposal(ms, proposal({ id: 1, kind: "archive", ids }), () => undefined);
  expect(r.changed).toEqual([first]);
  expect(r.messages.find((m) => m.id === sent.id)).toEqual(sent);
  expect(r.messages.find((m) => m.id === trashed.id)).toEqual(trashed);
  expect(applyProposal(ms, proposal({ id: 2, kind: "label", ids: [first], value: "Nonexistent" }), () => undefined).changed).toEqual([]);
  const l = applyProposal(ms, proposal({ id: 3, kind: "label", ids: [first], value: "design" }), (n) => (n === "design" ? "design" : undefined));
  expect(l.messages.find((m) => m.id === first)!.labels).toContain("design");
});

test("a proposal that no longer applies is dropped from the Queue without a change", () => {
  const [a] = inbox();
  const decided: [number, string, number[]][] = [];
  const { mail } = app([proposal({ id: 1, kind: "archive", ids: [a] })], decided);
  mail.select(a);
  mail.archive();
  mail.approve(1);
  expect(mail.proposals()).toEqual([]);
  expect(decided).toEqual([[1, "dismissed", []]]);
});

test("decisions are kept: status in the store, and an approval in the action log", () => {
  const store = new Store(":memory:");
  const remote = new Remote(store, memorySecrets());
  const p = store.addProposal({ kind: "archive", ids: [1, 2], reason: "Receipts" }, new Date("2026-11-06T09:00:00Z"));
  const q = store.addProposal({ kind: "markRead", ids: [3], reason: "Seen" }, new Date("2026-11-06T09:01:00Z"));
  expect(remote.pendingProposals().map((x) => x.id)).toEqual([p.id, q.id]); // oldest first
  remote.decide(p, "approved", [1, 2]);
  remote.decide(q, "dismissed", []);
  expect(remote.pendingProposals()).toEqual([]);
  expect(store.proposals("approved").map((x) => x.id)).toEqual([p.id]);
  expect(store.proposals("dismissed").map((x) => x.id)).toEqual([q.id]);
  expect(store.log()).toHaveLength(1);
  expect(store.log()[0]).toMatchObject({ actor: "user", proposal: p.id, action: "archive", ids: [1, 2], reason: "Receipts" });
  remote.stop();
  store.close();
});

test("undoing an approval puts the mail back and marks the proposal and the log, once", () => {
  const store = new Store(":memory:");
  const remote = new Remote(store, memorySecrets());
  const [a] = inbox();
  const p = store.addProposal({ kind: "archive", ids: [a], reason: "Read receipt" }, new Date("2026-11-06T09:00:00Z"));
  const mail = createMail(sampleMessages(), { proposals: [p], onDecide: remote.decide, onUndo: remote.undoDecision });
  mail.approve(p.id);
  expect(mail.messages().find((m) => m.id === a)!.folder).toBe("archive");
  mail.undo();
  expect(mail.messages().find((m) => m.id === a)!.folder).toBe("inbox");
  expect(store.proposals("undone").map((x) => x.id)).toEqual([p.id]);
  expect(store.log().map((e) => e.action)).toEqual(["undo archive", "archive"]);
  mail.undo(); // nothing more to undo: no second entry
  expect(store.log()).toHaveLength(2);
  // an ordinary undo (not an approval) leaves the log alone
  mail.select(a);
  mail.archive();
  mail.undo();
  expect(store.log()).toHaveLength(2);
  remote.stop();
  store.close();
});
