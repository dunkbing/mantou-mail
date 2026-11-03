// Mantou Mail on a headless instance of the real core: what you see, what
// presses, keys and the wheel do.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { createMail, type Mail } from "../src/state";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

function app() {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  let mail!: Mail;
  mount(h.ui, () => {
    mail = createMail();
    return <App mail={mail} />;
  });
  h.step();
  return { h, mail };
}

const texts = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isText).map((n) => n.textContent);
function text(h: HeadlessCore, content: string, nth = 0): Node {
  const found = [...h.ui.nodes.values()].filter((n) => n.isText && n.textContent === content);
  if (nth < 0) nth += found.length;
  if (!found[nth]) throw new Error(`no text "${content}" (have: ${texts(h).slice(0, 40).join(" | ")})`);
  return found[nth];
}
const readerSubject = (h: HeadlessCore, mail: Mail) => text(h, mail.selected()!.subject, 1); // [0] is the list row

test("opens on the Important tab of all inboxes, newest first, with the first message in the reader", () => {
  const { h, mail } = app();
  expect(mail.list()[0].subject).toBe("Onboarding flow: final review before Thursday");
  expect(h.rect(readerSubject(h, mail))![0]).toBeGreaterThan(600); // the reader is right of the list
  expect(texts(h)).toContain("Important");
  expect(texts(h)).toContain("All inboxes");
  expect(h.stats().opErrors).toBe(0);
});

test("pressing a row opens it and marks it read", () => {
  const { h, mail } = app();
  const before = mail.unread({ kind: "all" });
  h.press(text(h, "Sunday lunch?"));
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  expect(mail.selected()!.unread).toBe(false);
  expect(mail.unread({ kind: "all" })).toBe(before - 1);
  expect(texts(h).filter((t) => t === "Sunday lunch?").length).toBe(2); // list row and reader
});

test("keyboard triage: j/k move, e archives, z undoes, s stars", () => {
  const { h, mail } = app();
  const first = mail.list()[0];
  h.key("j");
  expect(mail.selected()!.id).toBe(mail.list()[1].id);
  h.key("k");
  expect(mail.selected()!.id).toBe(first.id);
  const n = mail.list().length;
  h.key("e");
  expect(mail.list().length).toBe(n - 1);
  expect(mail.messages().find((m) => m.id === first.id)!.folder).toBe("archive");
  expect(texts(h).some((t) => t.startsWith("Archived “Onboarding flow"))).toBe(true);
  h.key("z");
  expect(mail.list().length).toBe(n);
  h.key("s");
  expect(mail.selected()!.starred).toBe(true);
});

test("the Other tab holds newsletters and notifications", () => {
  const { h, mail } = app();
  h.key("2");
  expect(mail.tab()).toBe("other");
  expect(mail.list().every((m) => !m.important)).toBe(true);
  expect(texts(h)).toContain("[northwind/app] Release v4.2.0 is ready for review (#1834)");
  h.press(text(h, "Important"));
  expect(mail.tab()).toBe("important");
});

test("the wheel scrolls the list, and the selection stays in view", () => {
  const { h, mail } = app();
  const row = text(h, "Onboarding flow: final review before Thursday");
  const y0 = h.rect(row)![1];
  h.wheel(400, 400, 120);
  expect(h.rect(row)![1]).toBeCloseTo(y0 - 120, 0);
  h.wheel(400, 400, -1000);
  expect(h.rect(row)![1]).toBeCloseTo(y0, 0); // clamped at the top
  for (let i = 0; i < 12; i++) h.key("j");
  const sel = text(h, mail.selected()!.subject);
  const r = h.rect(sel)!;
  expect(r[1]).toBeGreaterThan(52);
  expect(r[3]).toBeLessThan(760 - 28);
});

test("quick reply: r shows the replies, 1 sends the first", () => {
  const { h, mail } = app();
  h.key("r");
  expect(mail.replying()).toBe(true);
  expect(texts(h).some((t) => t.startsWith("QUICK REPLY TO PRIYA SHAH"))).toBe(true);
  h.key("1");
  expect(mail.replying()).toBe(false);
  expect(texts(h)).toContain("Reply sent to Priya Shah");
  expect(mail.conversation().at(-1)!.body).toEqual(["Thanks, got it!"]); // the reply joins the conversation
  h.press(text(h, "Sent"));
  expect(mail.list().map((m) => m.subject)).toContain("Re: Onboarding flow: final review before Thursday");
});

test("the sidebar switches mailboxes and shows unread counts", () => {
  const { h, mail } = app();
  h.press(text(h, "Starred"));
  expect(mail.list().length).toBe(2);
  expect(texts(h)).toContain("Starred"); // the toolbar shows the mailbox's name instead of tabs
  h.press(text(h, "Family"));
  expect(mail.list().map((m) => m.from.name).sort()).toEqual(["Clara Rivera", "Mum"]);
  h.press(text(h, "Work"));
  expect(mail.list().every((m) => m.account === "work")).toBe(true);
});

test("the reader shows the whole conversation; earlier messages fold, and pressing one opens it", () => {
  const { h, mail } = app();
  h.press(text(h, "Re: Renewal terms for 2027"));
  expect(mail.conversation().map((m) => m.from.name)).toEqual(["Jonas Weber", "Sam Rivera", "Jonas Weber"]);
  expect(texts(h)).toContain("3 messages");
  const first = "Our contract is up for renewal in January. Before we talk numbers, could you send over our usage for the last twelve months?";
  expect(texts(h)).not.toContain(first); // folded to a one-line preview
  h.press(text(h, "Me")); // the folded reply opens…
  expect(texts(h)).toContain("Happy to walk through it on a call.");
  h.press(text(h, "Me"));
  expect(texts(h)).not.toContain("Happy to walk through it on a call."); // …and folds again
  expect(texts(h)).toContain("3"); // the list row counts the conversation's messages
});

test("snooze: h shows the times, 2 snoozes until tomorrow", () => {
  const { h, mail } = app();
  const first = mail.selected()!;
  h.key("h");
  expect(mail.panel()).toBe("snooze");
  expect(texts(h)).toContain("SNOOZE UNTIL");
  h.key("2");
  expect(mail.messages().find((m) => m.id === first.id)).toMatchObject({ folder: "snoozed", snoozedUntil: "Tomorrow, 08:00" });
  expect(mail.list().some((m) => m.id === first.id)).toBe(false);
  expect(texts(h)).toContain("Snoozed until Tomorrow, 08:00");
  h.press(text(h, "Snoozed"));
  expect(mail.list().length).toBe(2);
  h.press(text(h, mail.messages().find((m) => m.id === first.id)!.subject));
  h.key("i"); // move to inbox: unsnoozed
  expect(mail.messages().find((m) => m.id === first.id)).toMatchObject({ folder: "inbox", snoozedUntil: undefined });
});

test("labels: l shows them, digits toggle them, z undoes", () => {
  const { h, mail } = app();
  h.key("l");
  expect(texts(h)).toContain("LABELS");
  h.key("2");
  expect(mail.selected()!.labels).toEqual(["design", "finance"]);
  expect(texts(h)).toContain("Added label Finance");
  h.key("1");
  expect(mail.selected()!.labels).toEqual(["finance"]);
  h.press(text(h, "Travel", -1)); // the panel's (the sidebar and list rows have one too)
  expect(mail.selected()!.labels).toEqual(["finance", "travel"]);
  h.key("Escape");
  expect(mail.panel()).toBe(null);
  h.key("z");
  h.key("z");
  h.key("z");
  expect(mail.selected()!.labels).toEqual(["design"]);
});

test("Archive and Trash: move back to the inbox, delete forever, undo brings it back", () => {
  const { h, mail } = app();
  h.press(text(h, "Archive"));
  expect(mail.selected()!.folder).toBe("archive");
  expect(texts(h)).toContain("Move to Inbox");
  const archived = mail.selected()!;
  h.key("i");
  expect(mail.messages().find((m) => m.id === archived.id)!.folder).toBe("inbox");

  h.press(text(h, "All inboxes"));
  const doomed = mail.selected()!;
  h.key("#");
  h.press(text(h, "Trash"));
  expect(mail.selected()!.id).toBe(doomed.id);
  expect(texts(h)).toContain("Delete forever");
  h.key("#");
  expect(mail.messages().some((m) => m.id === doomed.id)).toBe(false);
  expect(texts(h)).toContain("Nothing here");
  h.press(text(h, "Undo"));
  expect(mail.messages().find((m) => m.id === doomed.id)!.folder).toBe("trash");
  expect(mail.selected()!.id).toBe(doomed.id); // undo selects it again
});

test("search: / then type; keys go to the query; Enter keeps the results, Esc goes back", () => {
  const { h, mail } = app();
  h.press(text(h, "Personal"));
  const n = mail.list().length;
  h.key("/");
  expect(mail.searching()).toBe(true);
  expect(texts(h)).toContain("Search your mail");
  for (const c of "lisbonx") h.key(c);
  expect(texts(h)).toContain("No messages match “lisbonx”");
  h.key("Backspace");
  expect(mail.list().map((m) => m.subject)).toEqual(["Lisbon flights are cheap again"]);
  expect(texts(h)).toContain("Results for “lisbon”");
  h.key("e"); // typed, not "archive"
  expect(mail.query()).toBe("lisbone");
  h.key("Backspace");
  h.key("Enter");
  expect(mail.searching()).toBe(false);
  h.key("s"); // triage works on the results
  expect(mail.selected()!.starred).toBe(true);
  h.key("Escape");
  expect(mail.mailbox()).toEqual({ kind: "account", id: "personal" });
  expect(mail.list().length).toBe(n);
});

test("search looks in every folder but Trash, by sender, subject and text", () => {
  const { h, mail } = app();
  h.key("/");
  for (const c of "procurement team") h.key(c);
  expect(mail.list().map((m) => m.folder).sort()).toEqual(["inbox"]);
  for (let i = 0; i < 16; i++) h.key("Backspace");
  for (const c of "jonas") h.key(c);
  expect(mail.list().map((m) => m.folder).sort()).toEqual(["archive", "inbox", "sent"]);
  expect(texts(h)).toContain("Archive"); // rows say where a result lives
});

test("? shows the keyboard shortcuts; Esc or a press outside closes them", () => {
  const { h, mail } = app();
  h.key("?");
  expect(texts(h)).toContain("Keyboard shortcuts");
  expect(texts(h)).toContain("Mark read / unread");
  const before = mail.selected()!.id;
  h.key("j"); // swallowed while the overlay is open
  expect(mail.selected()!.id).toBe(before);
  h.press(text(h, "Mark read / unread")); // inside the card: stays open
  expect(texts(h)).toContain("Mark read / unread");
  h.press([1150, 700]); // the backdrop
  expect(texts(h)).not.toContain("Mark read / unread");
  h.press(text(h, "Keyboard shortcuts"));
  h.key("Escape");
  expect(texts(h)).not.toContain("Mark read / unread");
});

test("scrolling moves only the list: the status bar stays put, and the scrollbar is inside the list", () => {
  const { h } = app();
  const status = text(h, "11 conversations");
  const y = h.rect(status)![1];
  h.wheel(400, 400, 300);
  expect(h.rect(status)![1]).toBe(y);
  const thumb = h.scene().split("\n").find((l) => l.includes(" #0000002a "))!.split(" ").slice(1, 5).map(Number);
  expect(thumb[2]).toBeLessThanOrEqual(629); // the list's right edge
  expect(thumb[0]).toBeGreaterThan(600);
  expect(thumb[1]).toBeGreaterThan(53);
});

test("it draws: sidebar, accent, text", () => {
  const { h } = app();
  const shot = h.capture();
  expect(shot.at(100, 700)).toEqual([0xf7, 0xf7, 0xf9, 255]); // sidebar
  let ink = 0;
  for (let x = 660; x < 1100; x++) if (shot.at(x, 95)[0] < 80) ink++; // the reader's subject line
  expect(ink).toBeGreaterThan(100);
}, 30_000);
