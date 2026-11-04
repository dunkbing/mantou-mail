// Adding a real account through the Accounts dialog, against an IMAP server in
// the test process, and what the app shows once it's synced.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { Blobs } from "../src/mail/blobs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMail, type Mail } from "../src/state";
import { imapServer, oauthServer, until } from "./server";
import { glyph } from "../src/ui/icons";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const texts = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isText).map((n) => n.textContent);
function text(h: HeadlessCore, content: string): Node {
  const found = [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === content);
  if (!found) throw new Error(`no text "${content}" (have: ${texts(h).slice(0, 60).join(" | ")})`);
  return found;
}
const inputs = (h: HeadlessCore) => [...h.ui.nodes.values()].filter((n) => n.isInput).sort((a, b) => h.rect(a)![1] - h.rect(b)![1] || h.rect(a)![0] - h.rect(b)![0]);

async function app() {
  const server = await imapServer({
    inbox: [
      { from: "Priya Shah <priya@example.com>", subject: "Onboarding review", body: "Could you look at it before Thursday?" },
      { from: "The Browser <hello@thebrowser.com>", subject: "Five things worth reading", body: "1. Maps.", headers: "List-Unsubscribe: <mailto:u@x.com>" },
    ],
  });
  cleanup.push(() => server.close());
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { dialogs: true }); // Mantou's dialogs, answered by the tests
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail: Mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();
  return { h, mail, remote, server };
}

/** Replaces an input's text, as a person would: select all, type. */
function retype(h: HeadlessCore, input: Node, text: string) {
  h.press(input);
  h.key("a", { primary: true });
  h.type(text);
}

test("the Accounts dialog adds an IMAP account; its mail replaces the sample mail", async () => {
  const { h, mail, server } = await app();
  expect(texts(h)).toContain("Add your account");
  h.press(text(h, "Add your account"));
  expect(texts(h)).toContain("ADD AN IMAP ACCOUNT");
  h.type("testuser@example.com"); // the email field has the focus
  const [, email, password, name, host, port, smtpHost, smtpPort, user] = inputs(h); // [0] is search
  expect(h.value(email)).toBe("testuser@example.com");
  expect(h.value(host)).toBe("imap.example.com"); // guessed from the address
  expect(h.value(user)).toBe("testuser@example.com");
  expect(h.value(smtpHost)).toBe("smtp.example.com");
  expect(h.value(smtpPort)).toBe("465");
  h.key("Enter"); // on to the password
  h.type("wrong");
  expect(texts(h)).not.toContain("wrong"); // the password isn't shown (a secure input draws bullets)
  expect(h.value(password)).toBe("wrong");
  retype(h, name, "Test User");
  retype(h, host, "127.0.0.1");
  retype(h, port, String(server.settings.port));
  retype(h, smtpHost, "127.0.0.1");
  retype(h, smtpPort, String(server.smtp.settings.port));
  retype(h, user, "testuser");
  expect(texts(h)).toContain("STARTTLS");
  h.press(text(h, "Connect"));
  await until(() => texts(h).some((t) => t.startsWith("The server didn't accept the password")), "the login to fail", () => h.step());
  expect(texts(h)).toContain("If your account has 2-step verification, it most likely needs an app password for mail apps, not your usual one."); // the general guide
  expect(mail.accounts()[0].sample).toBe(true); // nothing was added

  retype(h, password, "testpass");
  h.press(text(h, "Connect"));
  await until(() => texts(h).includes("testuser@example.com is up to date"), "the first sync", () => h.step());
  expect(mail.accounts().map((a) => a.email)).toEqual(["testuser@example.com"]);
  expect(texts(h)).toContain("Remove");
  h.key("Escape");
  expect(texts(h)).not.toContain("ADD AN IMAP ACCOUNT");
  expect(texts(h)).toContain("Manage accounts");
  expect(mail.list().map((m) => m.subject)).toEqual(["Onboarding review"]);
  expect(texts(h)).toContain("Onboarding review");
  expect(texts(h)).not.toContain("Sunday lunch?"); // the sample mail is gone

  await server.deliver("INBOX", { from: "Alex Kim <alex@example.com>", subject: "Lisbon flights", body: "Cheap again!" });
  await until(() => texts(h).includes("Lisbon flights"), "new mail", () => h.step());
});

test("Tab stays in a dialog: it doesn't reach the search field behind it", async () => {
  const { h, mail } = await app();
  h.key("c");
  for (let i = 0; i < 3; i++) h.key("Tab"); // To, Subject, the text, and once more
  expect(mail.searching()).toBe(false);
  expect(h.rect(h.focused()!)![1]).toBeGreaterThan(150); // in the composer, not the sidebar's search field
  h.key("Escape");
  h.press(text(h, "Add your account"));
  for (let i = 0; i < 7; i++) h.key("Tab");
  expect(mail.searching()).toBe(false);
});

test("an account's signature is typed in Accounts, and kept", async () => {
  const { h, remote, server } = await app();
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings });
  await remote.syncOf(a.id)!.firstSync;
  h.step();
  h.press(text(h, "Manage accounts"));
  h.step();
  h.press(inputs(h)[1]); // [0] is search; the account's signature comes first in the dialog
  h.type("Best, Sam");
  expect(remote.accounts()[0].signature).toBe("Best, Sam");
});

test("the dock badge shows the unread count of real accounts", async () => {
  const { h, mail, remote, server } = await app();
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings });
  await remote.syncOf(a.id)!.firstSync;
  await until(() => (h.lastService() as { kind?: string }).kind === "setBadge", "the badge", () => h.step());
  expect(h.lastService()).toMatchObject({ kind: "setBadge", text: String(mail.unread({ kind: "all" })) });
  expect(mail.unread({ kind: "all" })).toBeGreaterThan(0);
});

test("removing the last account asks first, then brings the sample mail back", async () => {
  const { h, mail, remote, server } = await app();
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings });
  await remote.syncOf(a.id)!.firstSync;
  h.step();
  h.press(text(h, "Manage accounts"));
  h.press(text(h, "Remove")); // no answer: the message box was dismissed
  for (let i = 0; i < 5; i++) (h.step(), await Bun.sleep(0));
  expect(h.lastService()).toMatchObject({ kind: "message", level: "warning", buttons: ["Remove", "Cancel"] });
  expect(mail.accounts().map((x) => x.email)).toEqual(["testuser@example.com"]);
  h.answer(0); // Remove
  h.press(text(h, "Remove"));
  await until(() => mail.accounts()[0]?.sample === true, "the sample accounts", () => h.step());
  expect(texts(h)).toContain("Sunday lunch?");
});

test("the end of a real folder's list offers its older mail, and pressing it gets it", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ from: `Person ${i} <p${i}@example.com>`, subject: `Message ${i + 1}`, body: "Hello", date: `Tue, 03 Nov 2026 0${i}:00:00 +0000` }));
  const server = await imapServer({ inbox: many });
  cleanup.push(() => server.close());
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { window: 5 });
  cleanup.push(() => remote.stop());
  const mail = createMail([], { accounts: [], onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings });
  await remote.syncOf(a.id)!.firstSync;
  h.step();
  expect(texts(h)).toContain("3 more on the server");
  h.press(text(h, "Load older messages"));
  await until(() => mail.list().length === 8, "the older mail", () => h.step());
  expect(texts(h)).toContain("Message 1");
  expect(texts(h)).not.toContain("Load older messages");
});

test("attachments in the app: open one, forward it with f, attach a file by its path, take one off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const opened: string[] = [];
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { blobs: new Blobs(join(dir, "blobs")), downloads: dir, open: (p) => opened.push(p) });
  remote.pickFiles = async () => null; // no picker on this system: the composer asks for a path
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();

  h.press(text(h, "Q4 planning — draft OKRs attached"));
  h.press(text(h, "Q4 OKRs (draft).md"));
  await until(() => opened.length === 1, "the attachment to open", () => h.step());
  expect(await Bun.file(opened[0]).text()).toStartWith("# Q4 OKRs (draft)");
  expect(texts(h).some((t) => t.startsWith("Saved “Q4 OKRs (draft).md” to "))).toBe(true);

  h.key("f");
  expect(mail.composing()).toBe(true);
  expect(mail.draft().subject).toBe("Fwd: Q4 planning — draft OKRs attached");
  expect(texts(h).filter((t) => t === "Q4 OKRs (draft).md").length).toBe(2); // in the reader, and on the forward
  const extra = join(dir, "agenda.txt");
  await Bun.write(extra, "1. OKRs\n2. Hiring\n");
  h.press(text(h, "Attach"));
  await until(() => !!h.focused() && h.rect(h.focused()!)![0] > 500, "the path field", () => h.step());
  h.type(extra);
  h.key("Enter");
  await until(() => texts(h).includes("agenda.txt"), "the new attachment", () => h.step());
  expect(mail.draft().attachments!.map((a) => a.name)).toEqual(["Q4 OKRs (draft).md", "agenda.txt"]);
  const removes = [...h.ui.nodes.values()].filter((n) => n.isText && n.textContent === glyph("close"));
  h.press(removes.at(-1)!); // agenda.txt's
  expect(mail.draft().attachments!.map((a) => a.name)).toEqual(["Q4 OKRs (draft).md"]);
  h.press(inputs(h)[1]); // To
  h.type("priya@northwind.dev");
  h.press(text(h, "Send"));
  expect(mail.composing()).toBe(false);
  h.press(text(h, "Sent"));
  expect(mail.list()[0]).toMatchObject({ subject: "Fwd: Q4 planning — draft OKRs attached", attachments: [{ name: "Q4 OKRs (draft).md" }] });
});

test("the system's dialogs: attach with the file dialog, save an attachment where the person chooses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { blobs: new Blobs(join(dir, "blobs")), downloads: dir, open: () => {}, dialogs: true }); // Mantou's dialogs, answered by the test
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();

  // Save as: the dialog suggests the name in Downloads; the file goes where it says.
  h.press(text(h, "Q4 planning — draft OKRs attached"));
  const saveButton = () => [...h.ui.nodes.values()].find((n) => n.isText && n.textContent === glyph("download"))!;
  h.answer(join(dir, "okrs.md"));
  h.press(saveButton());
  await until(() => texts(h).some((t) => t.startsWith("Saved “Q4 OKRs (draft).md” to ")), "the save", () => h.step());
  expect(h.lastService()).toMatchObject({ kind: "saveFile", directory: dir, name: "Q4 OKRs (draft).md" });
  expect(await Bun.file(join(dir, "okrs.md")).text()).toStartWith("# Q4 OKRs (draft)");
  h.press(saveButton()); // no answer: cancelled, nothing saved
  for (let i = 0; i < 5; i++) (h.step(), await Bun.sleep(0));
  expect(h.lastService()).toMatchObject({ kind: "saveFile" });

  // Attach: the file dialog, several files at once.
  const a = join(dir, "a.txt"), b = join(dir, "b.txt");
  await Bun.write(a, "A");
  await Bun.write(b, "BB");
  h.key("c");
  h.answer([a, b]);
  h.press(text(h, "Attach"));
  await until(() => mail.draft().attachments?.length === 2, "the attachments", () => h.step());
  expect(h.lastService()).toMatchObject({ kind: "openFile", multiple: true });
  expect(mail.draft().attachments!.map((x) => [x.name, x.size])).toEqual([["a.txt", 1], ["b.txt", 2]]);
  const fields = inputs(h).length;
  h.press(text(h, "Attach")); // cancelled: nothing more, and no path field
  for (let i = 0; i < 5; i++) (h.step(), await Bun.sleep(0));
  expect(mail.draft().attachments!.length).toBe(2);
  expect(inputs(h).length).toBe(fields);
});

test("a Gmail address signs in with Google in the browser; an app password is still an option", async () => {
  const server = await imapServer({ inbox: [{ from: "Priya Shah <priya@example.com>", subject: "Onboarding review", body: "Thursday?" }] });
  cleanup.push(() => server.close());
  const o = oauthServer({ email: "sam.rivera@gmail.com", onToken: (t) => server.setAccessToken(t) });
  cleanup.push(o.close);
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  let opened = "";
  const remote = new Remote(store, memorySecrets(), { dialogs: true, oauth: { google: o.provider }, openUrl: async (url) => void (opened = url) });
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();
  h.press(text(h, "Add your account"));
  h.type("sam.rivera@gmail.com");
  expect(texts(h)).toContain("ADD A GOOGLE ACCOUNT");
  expect(texts(h)).not.toContain("STARTTLS"); // no password or server fields
  const before = inputs(h).length;
  h.press(text(h, "Use an app password"));
  expect(inputs(h).length).toBeGreaterThan(before); // the password form
  expect(texts(h)).toContain("ADD AN IMAP ACCOUNT");
  h.press(text(h, "Sign in with Google"));
  expect(texts(h)).toContain("ADD A GOOGLE ACCOUNT");
  // The test servers stand in for Gmail's (the dialog would use imap.gmail.com).
  remote.signInAndAdd = ((add) => (email: string, opts: object = {}) => add(email, { ...opts, imap: server.settings, smtp: server.smtp.settings }))(remote.signInAndAdd.bind(remote));
  h.press(text(h, "Sign in with Google"));
  await until(() => !!opened, "the browser to open", () => h.step());
  expect(texts(h)).toContain("Waiting for the browser…");
  expect(texts(h)).toContain("Finish signing in in your browser.");
  await o.browser(opened); // the person signs in
  await until(() => texts(h).includes("sam.rivera@gmail.com is up to date"), "the first sync", () => h.step());
  expect(mail.accounts().map((a) => a.email)).toEqual(["sam.rivera@gmail.com"]);
  expect(texts(h)).not.toContain("Waiting for the browser…");
});

test("without a Google client id, a Gmail address uses an app password", async () => {
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const opened: string[] = [];
  const remote = new Remote(store, memorySecrets(), { oauth: { google: null, microsoft: null }, openUrl: (u) => void opened.push(u) });
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();
  h.press(text(h, "Add your account"));
  h.type("sam.rivera@gmail.com");
  expect(texts(h)).toContain("ADD AN IMAP ACCOUNT");
  // How to get one, step by step, and a button to the page where it's made.
  expect(texts(h)).toContain("Gmail needs an app password for mail apps: your Google password won't work here.");
  expect(texts(h)).toContain("Open App passwords (below), sign in, and name the new one “Mantou Mail”.");
  h.press(text(h, "Open Google's App passwords"));
  expect(opened).toEqual(["https://myaccount.google.com/apppasswords"]);
  // Another provider, another guide; an address the app doesn't know, none until a password is refused.
  h.press(inputs(h).find((n) => h.value(n) === "sam.rivera@gmail.com")!); // the email field again
  h.key("a", { primary: true });
  h.type("sam@icloud.com");
  expect(texts(h)).toContain("Go to Sign-In and Security › App-Specific Passwords, and press +.");
  h.key("a", { primary: true });
  h.type("sam@example.org");
  expect(texts(h).some((t) => t.includes("App-Specific"))).toBe(false);
  expect(texts(h).some((t) => t.startsWith("Most providers take an app password over IMAP"))).toBe(true);
});

test("a company address on Microsoft 365 (by its MX records) signs in with Microsoft", async () => {
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const ms = { id: "microsoft" as const, name: "Microsoft", noPasswords: true, authUrl: "http://127.0.0.1:9/a", tokenUrl: "http://127.0.0.1:9/t", scopes: [], clientId: "x", imap: { host: "outlook.office365.com", port: 993, secure: true }, smtp: { host: "smtp.office365.com", port: 587, secure: false } };
  const remote = new Remote(store, memorySecrets(), { oauth: { google: null, microsoft: ms }, mx: async (d) => (d === "northwind.dev" ? ["northwind-dev.mail.protection.outlook.com"] : []) });
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  cleanup.push(() => h.free());
  mount(h.ui, () => <App mail={mail} remote={remote} />);
  h.step();
  h.press(text(h, "Add your account"));
  expect(texts(h).some((t) => t.startsWith("Outlook and Microsoft 365 sign in with Microsoft. Most providers"))).toBe(true); // no Google client: only Microsoft is named
  h.type("sam@northwind.dev");
  expect(texts(h)).toContain("ADD AN IMAP ACCOUNT"); // until its MX records are in
  await until(() => texts(h).includes("ADD A MICROSOFT ACCOUNT"), "the MX lookup", () => h.step());
  expect(texts(h)).toContain("Sign in with Microsoft");
  expect(texts(h)).not.toContain("Use an app password"); // Microsoft takes none
});
