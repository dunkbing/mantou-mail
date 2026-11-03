// Mantou Mail on a headless instance of the real core: what you see, what
// presses, keys and the wheel do.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { createMail, parseRecipients, type Mail } from "../src/state";

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
const inputs = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isInput).sort((a, b) => h.rect(a)![1] - h.rect(b)![1] || h.rect(a)![0] - h.rect(b)![0]);
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

const SEND = { primary: true } as const; // Ctrl+Enter, or ⌘+Enter on macOS

test("reply: r opens the composer with the focus in it; a quick reply is a start; Ctrl+Enter sends", () => {
  const { h, mail } = app();
  h.key("r");
  expect(mail.replying()).toBe(true);
  expect(texts(h)).toContain("REPLY TO PRIYA SHAH");
  expect(h.focused()).not.toBe(null); // typing goes to the reply, not to triage
  h.press(text(h, "Thanks, got it!", -1));
  h.key("End");
  h.type(" I'll read it tonight.");
  expect(mail.draft().body).toBe("Thanks, got it! I'll read it tonight.");
  expect(mail.list().length).toBe(11); // "e", "#" and the rest were typed, not triage
  h.key("Enter", SEND);
  expect(mail.replying()).toBe(false);
  expect(texts(h)).toContain("Sent to Priya Shah");
  const sent = mail.conversation().at(-1)!; // the reply joins the conversation
  expect(sent).toMatchObject({ folder: "sent", subject: "Re: Onboarding flow: final review before Thursday", body: ["Thanks, got it! I'll read it tonight."] });
  expect(sent.to).toEqual([{ name: "Priya Shah", email: "priya@northwind.dev" }]);
  expect(mail.selected()!.waitingSince).toBeDefined();
  h.key("z"); // undo send
  expect(mail.messages().some((m) => m.id === sent.id)).toBe(false);
});

test("a reply in progress is kept as a draft: Esc saves it, r brings it back, Discard drops it", () => {
  const { h, mail } = app();
  h.key("r");
  h.type("Half a thought");
  h.key("Escape");
  expect(mail.replying()).toBe(false);
  expect(texts(h)).toContain("Draft saved");
  expect(texts(h)).not.toContain("Undo"); // saving a draft isn't an undo step
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(1);
  expect(mail.conversation().length).toBe(3); // drafts stay out of the conversation
  h.key("r");
  expect(mail.draft().body).toBe("Half a thought");
  h.press(text(h, "Discard"));
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(0);
  expect(texts(h)).toContain("Draft discarded");
});

test("compose: c opens a new message; Enter moves on from To and Subject; it sends to a known name", () => {
  const { h, mail } = app();
  h.key("c");
  expect(mail.composing()).toBe(true);
  expect(texts(h)).toContain("New message");
  h.type("jonas@acme.io");
  h.key("Enter");
  h.type("Renewal call");
  h.key("Enter");
  h.type("Hi Jonas,\n\nThe 15th works. 10:00 your time?");
  expect(mail.draft()).toMatchObject({ to: "jonas@acme.io", subject: "Renewal call", body: "Hi Jonas,\n\nThe 15th works. 10:00 your time?" });
  h.press(text(h, "Personal · sam.rivera@fastmail.com"));
  h.press(text(h, "Work · sam@northwind.dev"));
  h.key("Enter", SEND);
  expect(mail.composing()).toBe(false);
  expect(texts(h)).toContain("Sent to Jonas Weber"); // the name comes from his earlier mail
  h.press(text(h, "Sent"));
  expect(mail.selected()).toMatchObject({ subject: "Renewal call", body: ["Hi Jonas,", "The 15th works. 10:00 your time?"], account: "work" });
  expect(texts(h)).toContain("To: Jonas Weber");
});

test("compose won't send to a bad address, or to nobody", () => {
  const { h, mail } = app();
  h.press(text(h, "Compose"));
  h.press(text(h, "Send"));
  expect(texts(h)).toContain("Add a recipient first");
  h.press(inputs(h)[1]); // the To line ([0] is search)
  h.type("Priya Shah <priya@northwind.dev>, not-an-email");
  expect(texts(h)).not.toContain("Add a recipient first"); // an edit clears the problem
  h.key("Tab"); // Tab moves through the inputs: Subject, then the text
  h.key("Tab");
  h.type("Hello");
  h.key("Enter", SEND);
  expect(texts(h)).toContain("“not-an-email” isn't an email address");
  expect(mail.composing()).toBe(true);
});

test("Esc keeps a new message in Drafts; Enter on it opens it again", () => {
  const { h, mail } = app();
  h.key("c");
  h.type("alex.kim@hey.com");
  h.key("Enter");
  h.type("Lisbon");
  h.key("Escape");
  expect(mail.composing()).toBe(false);
  h.press(text(h, "Drafts"));
  expect(texts(h)).toContain("To: Alex Kim");
  expect(texts(h)).toContain("Draft");
  h.key("Enter");
  expect(mail.composing()).toBe(true);
  expect(mail.draft()).toMatchObject({ to: "alex.kim@hey.com", subject: "Lisbon" });
  h.key("Escape");
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(1); // the same draft, not a second one
  h.press(text(h, "Edit draft"));
  h.press(text(h, "Discard"));
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(0);
});

test("the search field is an Input: / focuses it, a press elsewhere leaves it, results stay", () => {
  const { h, mail } = app();
  h.key("/");
  expect(h.focused()).not.toBe(null);
  expect(mail.searching()).toBe(true);
  h.type("receipt");
  h.press(text(h, "Your receipt from Figma #2231-7746"));
  expect(h.focused()).toBe(null);
  expect(mail.searching()).toBe(false);
  expect(mail.query()).toBe("receipt");
  h.key("/");
  h.key("Escape");
  expect(h.focused()).toBe(null);
  expect(mail.mailbox()).toEqual({ kind: "all" });
});

test("To lines parse names and addresses", () => {
  const known = [{ name: "Jonas Weber", email: "jonas@acme.io" }];
  expect(parseRecipients("Priya Shah <priya@northwind.dev>, JONAS@acme.io, \"Mum\" <elena.rivera@gmail.com>", known)).toEqual({
    ok: [
      { name: "Priya Shah", email: "priya@northwind.dev" },
      { name: "Jonas Weber", email: "JONAS@acme.io" },
      { name: "Mum", email: "elena.rivera@gmail.com" },
    ],
    bad: [],
  });
  expect(parseRecipients("sam, sam@, @x.io, a@b").bad).toEqual(["sam", "sam@", "@x.io", "a@b"]);
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
