// Mantou Mail on a headless instance of the real core: what you see, what
// presses, keys and the wheel do.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { createMail, formatContacts, parseRecipients, sendLaterOptions, suggestRecipients, type Mail } from "../src/state";
import { sampleMessages } from "../src/data";
import { rowHeight } from "../src/ui/MessageList";
import { menus } from "../src/ui/PopupMenu";

const open: HeadlessCore[] = [];
const nativeMenus = menus.native;
afterEach(() => {
  open.splice(0).forEach((h) => h.free());
  menus.native = nativeMenus;
});

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
/** A text in the message list (left of x 629), or in the reader (right of it): the same subject can be in both. */
function inList(h: HeadlessCore, content: string): Node {
  const found = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === content && h.rect(n) && h.rect(n)![2] <= 629);
  if (!found) throw new Error(`no "${content}" in the list`);
  return found;
}
function inReader(h: HeadlessCore, content: string): Node {
  const found = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === content && h.rect(n) && h.rect(n)![0] > 629);
  if (!found) throw new Error(`no "${content}" in the reader`);
  return found;
}
const readerSubject = (h: HeadlessCore, mail: Mail) => inReader(h, mail.selected()!.subject);

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
  const row = inList(h, "Onboarding flow: final review before Thursday");
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
  expect(texts(h)).toContain("REPLY");
  expect(texts(h)).toContain("To Priya Shah");
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
  // The core's scrollbar thumb, at the list's right edge (x 629 is the rule between list and reader).
  const thumb = h.scene().split("\n").filter((l) => l.startsWith("quad ")).map((l) => l.split(" ").slice(1, 5).map(Number)).find(([x0, y0, x1]) => x0 > 600 && x1 <= 629 && x1 - x0 <= 8 && y0 > 53);
  expect(thumb).toBeDefined();
});

test("a big mailbox keeps rows only for what's in view: the wheel and the selection bring theirs", () => {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  const base = sampleMessages().filter((m) => m.folder === "inbox" && m.important);
  const many = Array.from({ length: 2000 }, (_, i) => ({ ...base[i % base.length], id: i + 1, thread: undefined, subject: `Message ${i + 1}`, date: new Date(Date.UTC(2026, 10, 3) - i * 3_600_000) }));
  let mail!: Mail;
  mount(h.ui, () => {
    mail = createMail(many);
    return <App mail={mail} />;
  });
  h.step();
  const rendered = () => texts(h).filter((t) => /^Message \d+$/.test(t)).length - 1; // the reader shows the selected one too
  expect(rendered()).toBeLessThan(20);
  expect(texts(h)).not.toContain("Message 200");
  for (let i = 0; i < 30; i++) h.wheel(400, 400, 600);
  expect(rendered()).toBeLessThan(20);
  expect(texts(h)).not.toContain("Message 2");
  for (let i = 0; i < 200; i++) h.key("j");
  expect(mail.selected()!.subject).toBe("Message 201");
  expect(texts(h).filter((t) => t === "Message 201").length).toBe(2); // its row is there, with the reader
  const row = h.rect(inList(h, "Message 201"))!;
  expect(row[1]).toBeGreaterThan(53); // in view, under the toolbar
  expect(row[3]).toBeLessThan(731); // above the status bar
  h.key("2");
  h.key("1");
  expect(texts(h)).toContain("Message 1"); // a new mailbox starts at the top
});

test("rows are as tall as the list places them (ROW_HEIGHT, ROW_WITH_CHIPS)", () => {
  const { h, mail } = app();
  for (const msg of mail.list()) {
    const t = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === (msg.subject || "(no subject)") && h.rect(n)![2] <= 629);
    if (!t || h.rect(t)![1] > 731) continue; // not in view
    const [, top, , bottom] = h.rect(t.parent!.parent!)!; // subject → its column → the row
    expect(bottom - top + 1).toBe(rowHeight(mail, msg)); // and the 1 px rule under it
  }
});

test("a right click on a row selects it and opens a menu of what to do with it (the system's, on macOS)", async () => {
  menus.native = true;
  const { h, mail } = app();
  const [x, y] = h.rect(text(h, "Sunday lunch?"))!;
  h.pointerButton("down", 2, x + 10, y + 5);
  await Bun.sleep(100); // the menu opens once the selection is drawn
  const asked = h.lastService() as unknown as { kind: string; x: number; y: number; items: { id?: string; label?: string }[] };
  expect([asked.x, asked.y]).toEqual([x + 10, y + 5]);
  expect(asked.kind).toBe("showMenu");
  expect(asked.items.filter((i) => i.id).map((i) => i.id)).toEqual(["reply", "replyAll", "forward", "archive", "inbox", "delete", "snooze", "label", "star", "unread"]);
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  h.chooseMenu("archive");
  for (let i = 0; i < 5; i++) (h.step(), await Bun.sleep(0));
  expect(mail.messages().find((m) => m.subject === "Sunday lunch?")!.folder).toBe("archive");
});

test("a right click on one of several picked rows keeps them, and the menu archives all of them", async () => {
  menus.native = true;
  const { h, mail } = app();
  mail.select(mail.list()[0].id);
  mail.pick(mail.list()[2].id, true);
  h.step();
  const ids = [...mail.picked()];
  const [x, y] = h.rect(inList(h, mail.list()[1].subject))!;
  h.pointerButton("down", 2, x + 10, y + 5).pointerButton("up", 2, x + 10, y + 5);
  await Bun.sleep(100); // the menu opens once the selection is drawn
  expect([...mail.picked()]).toEqual(ids); // still picked
  h.chooseMenu("archive");
  for (let i = 0; i < 5; i++) (h.step(), await Bun.sleep(0));
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.folder === "archive")).toBe(true);
  // and on a row that isn't picked, the pick ends and that row is selected
  mail.pick(mail.list()[1].id, true);
  const other = mail.list()[3];
  const [ox, oy] = h.rect(inList(h, other.subject))!;
  h.pointerButton("down", 2, ox + 10, oy + 5).pointerButton("up", 2, ox + 10, oy + 5);
  await Bun.sleep(100); // the menu opens once the selection is drawn
  expect(mail.picked().size).toBe(0);
  expect(mail.selected()!.id).toBe(other.id);
});

test("where the system has no context menus (Linux, Windows), the app draws its own: keys, hover, a press outside", async () => {
  menus.native = false;
  const { h, mail } = app();
  const at = (t: string) => h.rect(text(h, t, -1))!;
  const [x, y] = h.rect(text(h, "Sunday lunch?"))!;
  h.pointerButton("down", 2, x + 10, y + 5);
  h.step();
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  expect(texts(h)).toContain("Mark as Read or Unread");
  const [mx, my] = at("Reply All");
  expect([mx, my].every((v, i) => v > [x, y][i])).toBe(true); // at the pointer
  h.key("j"); // the menu has the keys: no triage behind it
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  h.key("ArrowDown"); // Reply
  h.key("ArrowDown"); // Reply All
  h.key("ArrowUp");
  h.key("Escape");
  expect(texts(h)).not.toContain("Mark as Read or Unread");
  expect(mail.replying()).toBe(false); // Escape closed the menu, nothing else
  // Enter takes the one the keys are on.
  h.pointerButton("down", 2, x + 10, y + 5);
  h.step();
  h.key("ArrowDown");
  h.key("Enter");
  await Bun.sleep(0); // the menu answers like the system's: a promise
  expect(mail.replying()).toBe(true);
  h.key("Escape");
  // A press outside closes it and does nothing else; a press on an item runs it.
  h.pointerButton("down", 2, x + 10, y + 5);
  h.step();
  h.press(text(h, "Onboarding flow: final review before Thursday"));
  expect(texts(h)).not.toContain("Mark as Read or Unread");
  expect(mail.selected()!.subject).toBe("Sunday lunch?");
  h.pointerButton("down", 2, x + 10, y + 5);
  h.step();
  h.press(text(h, "Archive", -1));
  await Bun.sleep(0);
  expect(mail.messages().find((m) => m.subject === "Sunday lunch?")!.folder).toBe("archive");
  expect(texts(h)).not.toContain("Mark as Read or Unread");
});

test("the drawn menu stays inside the window near its edges", () => {
  menus.native = false;
  const { h } = app();
  // A right click low on the list: the menu opens upwards, inside the window.
  const rows = [...h.ui.nodes.values()].filter((n) => n.isText && n.textContent === "Re: Renewal terms for 2027");
  const [x, y] = h.rect(rows[0])!;
  h.pointerButton("down", 2, x + 10, y + 5);
  h.step();
  const last = h.rect(text(h, "Mark as Read or Unread"))!;
  expect(last[3]).toBeLessThan(y + 5); // above the pointer
  expect(h.rect(text(h, "Reply", -1))![1]).toBeGreaterThan(0);
});

test("when the server sends a message back as another row (same Message-ID), the selection stays on it", () => {
  const { mail } = app();
  const base = sampleMessages().filter((m) => m.folder === "inbox" && m.important);
  const acct = base[0].account;
  const mk = (id: number, messageId: string, d: number): (typeof base)[number] => ({ ...base[0], id, messageId, account: acct, remote: { path: "INBOX", uid: id }, date: new Date(Date.UTC(2026, 10, 3) - d * 3_600_000) });
  mail.receive(acct, [mk(901, "a@x", 1), mk(902, "b@x", 2), mk(903, "c@x", 3)]);
  mail.select(902);
  expect(mail.selected()!.id).toBe(902);
  mail.receive(acct, [mk(901, "a@x", 1), mk(912, "b@x", 2), mk(903, "c@x", 3)]); // b came back as another row
  expect(mail.selected()!.id).toBe(912);
});

test("a refresh that changes nothing keeps the very same messages (rows aren't rebuilt); a changed one is replaced", () => {
  const { mail } = app();
  const base = sampleMessages().filter((m) => m.folder === "inbox" && m.important);
  const acct = base[0].account;
  const mk = (id: number, unread = false) => ({ ...base[0], id, messageId: `m${id}@x`, account: acct, remote: { path: "INBOX", uid: id }, unread, date: new Date(Date.UTC(2026, 10, 3) - id * 3_600_000) });
  mail.receive(acct, [mk(1), mk(2)]);
  const first = mail.messages().filter((m) => m.remote);
  mail.receive(acct, [mk(1), mk(2)]); // fresh objects, same content
  expect(mail.messages().filter((m) => m.remote).every((m, i) => m === first[i])).toBe(true);
  mail.receive(acct, [mk(1), mk(2, true)]);
  const now = mail.messages().filter((m) => m.remote);
  expect(now[0]).toBe(first[0]);
  expect(now[1]).not.toBe(first[1]);
  expect(now[1].unread).toBe(true);
});

test("the click that dismisses a context menu doesn't select the row under it", async () => {
  const { h, mail } = app();
  const [a, b] = [mail.list()[0], mail.list()[3]];
  mail.select(a.id);
  const [x, y] = h.rect(inList(h, mail.list()[1].subject))!;
  h.pointerButton("down", 2, x + 10, y + 5);
  await Bun.sleep(100); // the menu opens once the selection is drawn
  expect(mail.selected()!.id).toBe(mail.list()[1].id);
  h.answer(null); // dismissed
  for (let i = 0; i < 3; i++) (h.step(), await Bun.sleep(0));
  h.press(text(h, b.subject)); // the dismissing click, arriving as a press
  expect(mail.selected()!.id).toBe(mail.list()[1].id);
  await Bun.sleep(400);
  h.press(text(h, b.subject)); // a later click is a click
  expect(mail.selected()!.id).toBe(b.id);
});

test("Send Later presets: in an hour, tomorrow morning and afternoon, Monday", () => {
  const at = (from: string) => sendLaterOptions(new Date(from)).map((o) => `${o.name} ${o.at.toString().slice(0, 21)}`);
  expect(at("2026-11-03T09:30:00")).toEqual(["In an hour Tue Nov 03 2026 10:30", "Tomorrow morning Wed Nov 04 2026 08:00", "Tomorrow afternoon Wed Nov 04 2026 13:00", "Monday morning Mon Nov 09 2026 08:00"]);
  expect(at("2026-11-08T21:12:00")[3]).toBe("Monday morning (tomorrow) Mon Nov 09 2026 08:00"); // on a Sunday
  expect(at("2026-11-09T07:00:00")[3]).toBe("Monday morning Mon Nov 16 2026 08:00"); // on a Monday: next week's
});

test("Send Later: the message waits in Scheduled, then goes; Edit takes it back to Drafts", () => {
  const { h, mail } = app();
  h.key("c");
  h.type("Jonas Weber <jonas@acme.io>");
  h.key("Enter");
  h.type("Renewal call");
  h.key("Enter");
  h.type("The 15th works.");
  h.press(text(h, "Send later"));
  h.press(text(h, "Tomorrow morning"));
  expect(mail.composing()).toBe(false);
  expect(texts(h)).toContain("Scheduled for Wed 4 Nov, 08:00");
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(1);
  h.press(text(h, "Scheduled"));
  expect(texts(h)).toContain("Scheduled · Wed 08:00");
  expect(texts(h)).toContain("Send now");
  mail.deliverDue(new Date("2026-11-04T07:59:00"));
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(1); // not yet
  mail.deliverDue(new Date("2026-11-04T08:00:00"));
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(0);
  h.press(text(h, "Sent"));
  expect(mail.list()[0]).toMatchObject({ subject: "Renewal call", outbox: undefined });

  // Scheduled again, then edited: back in the composer and in Drafts, unscheduled.
  h.key("c");
  h.type("alex.kim@hey.com");
  h.key("Enter");
  h.type("Lisbon");
  h.press(text(h, "Send later"));
  h.press(text(h, "Monday morning"));
  h.press(text(h, "Scheduled"));
  h.press(text(h, "Edit"));
  expect(mail.composing()).toBe(true);
  expect(mail.draft()).toMatchObject({ to: "Alex Kim <alex.kim@hey.com>", subject: "Lisbon" }); // named from his earlier mail
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(0);
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(1);
  h.press(text(h, "Send"));
  expect(mail.count({ kind: "folder", folder: "drafts" })).toBe(0);
});

test("it draws: sidebar, accent, text", () => {
  const { h } = app();
  const shot = h.capture();
  expect(shot.at(100, 700)).toEqual([0xf7, 0xf7, 0xf9, 255]); // sidebar
  let ink = 0;
  for (let x = 660; x < 1100; x++) if (shot.at(x, 95)[0] < 80) ink++; // the reader's subject line
  expect(ink).toBeGreaterThan(100);
}, 30_000);

test("the app menu: its items run the same commands as the keys", () => {
  const { h, mail } = app();
  const menu = h.lastService() as unknown as { kind: string; menu: { label: string; items: { id?: string; accelerator?: string }[] }[] };
  expect(menu.kind).toBe("setMenu");
  expect(menu.menu.map((x) => x.label)).toEqual(["Mantou Mail", "File", "Edit", "Message", "View", "Window", "Help"]);
  expect(menu.menu.flatMap((x) => x.items).filter((i) => i.accelerator && !i.accelerator.startsWith("cmd+"))).toEqual([]);
  const first = mail.selected()!.id;
  h.chooseMenu("archive");
  expect(mail.messages().find((x) => x.id === first)!.folder).toBe("archive");
  h.chooseMenu("undo");
  expect(mail.messages().find((x) => x.id === first)!.folder).toBe("inbox");
  h.chooseMenu("compose");
  expect(mail.composing()).toBe(true);
  h.chooseMenu("archive"); // the composer is open: triage waits
  expect(mail.messages().find((x) => x.id === first)!.folder).toBe("inbox");
  h.key("Escape");
  h.chooseMenu("shortcuts");
  expect(texts(h).filter((t) => t === "Keyboard shortcuts").length).toBe(2); // the status bar's, and the dialog's
});

test("reply all: a puts everyone else on the message in Cc (not you); it can go back to the sender only", () => {
  const { h, mail } = app();
  h.press(text(h, "Q4 planning — draft OKRs attached"));
  h.key("a");
  expect(mail.replying()).toBe(true);
  expect(mail.draft()).toMatchObject({ to: "Daniel Okafor <daniel@northwind.dev>", cc: "Product team <product@northwind.dev>, Priya Shah <priya@northwind.dev>" });
  expect(texts(h)).toContain("REPLY ALL");
  expect(texts(h)).toContain("To Daniel Okafor  ·  Cc Product team, Priya Shah");
  h.type("Looks good to me.");
  h.press(text(h, "Reply to sender"));
  expect(mail.draft()).toMatchObject({ cc: "", body: "Looks good to me." }); // the text stays
  h.press(text(h, "Reply all"));
  h.press(text(h, "Send"));
  const sent = mail.messages().at(-1)!;
  expect(sent.to!.map((c) => c.email)).toEqual(["daniel@northwind.dev"]);
  expect(sent.cc!.map((c) => c.email)).toEqual(["product@northwind.dev", "priya@northwind.dev"]);
  expect(texts(h)).toContain("Sent to Daniel Okafor, Product team, Priya Shah");
  // A message with no one else on it has no Reply all to offer.
  h.press(text(h, "Lisbon flights are cheap again"));
  h.key("r");
  expect(texts(h)).not.toContain("Reply all");
});

test("addresses: people you've written with are suggested; Enter or a press takes one; Cc and Bcc", () => {
  const { h, mail } = app();
  h.key("c");
  h.type("pri");
  expect(texts(h)).toContain("priya@northwind.dev"); // the suggestion
  h.key("Enter"); // takes it, and stays for the next one
  expect(mail.draft().to).toBe("Priya Shah <priya@northwind.dev>, ");
  h.type("ale");
  h.press(text(h, "Alex Kim", -1)); // the suggestion (the list behind has one too)
  h.type("m");
  const [first, second] = suggestRecipients(mail.draft().to, mail.contacts());
  expect(second).toBeDefined();
  h.key("ArrowDown");
  h.key("Enter"); // the second one
  expect(mail.draft().to).toBe(`Priya Shah <priya@northwind.dev>, Alex Kim <alex.kim@hey.com>, ${formatContacts([second])}, `); // the caret stayed at the end each time
  expect(first).not.toEqual(second);
  h.press(text(h, "Cc Bcc"));
  h.press(inputs(h)[2]); // Cc
  h.type("mira@northwind.dev");
  h.key("Enter"); // a whole address: on to Bcc, nothing taken
  expect(mail.draft().cc).toBe("mira@northwind.dev");
  h.type("daniel@northwind.dev");
  h.key("Enter"); // on to Subject
  h.type("Offsite");
  expect(mail.draft()).toMatchObject({ bcc: "daniel@northwind.dev", subject: "Offsite" });
  h.key("Enter");
  h.type("Friday?");
  h.press(text(h, "Send"));
  const sent = mail.messages().at(-1)!;
  expect(sent.to!.length).toBe(3);
  expect(sent.cc).toEqual([{ name: "Mira Kowalski", email: "mira@northwind.dev" }]); // its name, from earlier mail
  expect(sent.bcc).toEqual([{ name: "Daniel Okafor", email: "daniel@northwind.dev" }]);
});

test("it says attached but nothing is: Send warns once, and sends on the second press", () => {
  const { h, mail } = app();
  h.key("c");
  h.type("alex.kim@hey.com");
  h.key("Enter");
  h.type("Flights");
  h.key("Enter");
  h.type("I've attached the booking.");
  h.press(text(h, "Send"));
  expect(mail.composing()).toBe(true);
  expect(texts(h)).toContain("It says “attached”, but nothing is. Attach it, or Send again to send it as it is");
  h.press(text(h, "Send"));
  expect(mail.composing()).toBe(false);
  expect(mail.messages().at(-1)).toMatchObject({ subject: "Flights", folder: "sent" });
  // A forward that quotes "attached" from the original isn't warned about.
  h.press(text(h, "Lisbon flights are cheap again"));
  h.key("f");
  mail.editDraft({ to: "alex.kim@hey.com", body: `FYI\n\n---------- Forwarded message ----------\nThe tickets are attached.` });
  h.press(text(h, "Send"));
  expect(mail.composing()).toBe(false);
});

test("several conversations picked together (Shift: a range, Ctrl/⌘: one more) are archived, starred and marked unread at once", () => {
  const { h, mail } = app();
  const first = mail.list()[0].id;
  mail.select(first);
  mail.pick(mail.list()[2].id, true); // Shift+click: the range from the selected one
  expect([...mail.picked()]).toEqual(mail.list().slice(0, 3).map((m) => m.id));
  expect(texts(h)).toContain("3 conversations selected");
  mail.pick(mail.list()[1].id, false); // Ctrl+click takes one off
  expect(mail.picked().size).toBe(2);
  mail.pick(mail.list()[1].id, false); // and puts it back
  const ids = [...mail.picked()];
  mail.star();
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.starred)).toBe(true);
  expect(mail.status()).toBe("Starred 3 conversations");
  mail.pick(mail.list()[2].id, true);
  mail.archive();
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.folder === "archive")).toBe(true);
  expect(mail.picked().size).toBe(0);
  mail.undo();
  expect(ids.every((id) => mail.messages().find((m) => m.id === id)!.folder === "inbox")).toBe(true);
  mail.select(first); // a plain click is one again
  expect(mail.picked().size).toBe(0);
});
