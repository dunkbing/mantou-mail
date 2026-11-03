// Adding a real account through the Accounts dialog, against an IMAP server in
// the test process, and what the app shows once it's synced.
import { afterEach, expect, test } from "bun:test";
import { mount, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { createMail, type Mail } from "../src/state";
import { imapServer, until } from "./server";

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
  const remote = new Remote(store, memorySecrets());
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
  const [, email, password, name, host, port, user] = inputs(h); // [0] is search
  expect(h.value(email)).toBe("testuser@example.com");
  expect(h.value(host)).toBe("imap.example.com"); // guessed from the address
  expect(h.value(user)).toBe("testuser@example.com");
  h.key("Enter"); // on to the password
  h.type("wrong");
  expect(texts(h)).toContain("•••••"); // the password isn't shown
  retype(h, name, "Test User");
  retype(h, host, "127.0.0.1");
  retype(h, port, String(server.settings.port));
  retype(h, user, "testuser");
  expect(texts(h)).toContain("STARTTLS");
  h.press(text(h, "Connect"));
  await until(() => texts(h).some((t) => t.startsWith("The server didn't accept the password")), "the login to fail", () => h.step());
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

test("removing the last account brings the sample mail back", async () => {
  const { h, mail, remote, server } = await app();
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings });
  await remote.syncOf(a.id)!.firstSync;
  h.step();
  h.press(text(h, "Manage accounts"));
  h.press(text(h, "Remove"));
  await until(() => mail.accounts()[0]?.sample === true, "the sample accounts", () => h.step());
  expect(texts(h)).toContain("Sunday lunch?");
});
