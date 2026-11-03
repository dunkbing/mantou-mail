// Real accounts against an IMAP server in the test process: the first sync,
// the user's changes reaching the server, new mail arriving, and the saved copy.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { createMail, type Mail } from "../src/state";
import { imapServer, until } from "./server";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const PRIYA = { from: "Priya Shah <priya@example.com>", subject: "Onboarding review", body: "Hi,\n\nCould you look at the onboarding flow before Thursday?\n\nPriya", id: "onboarding", date: "Mon, 02 Nov 2026 16:00:00 +0000" };
const NEWS = { from: "The Browser <hello@thebrowser.com>", subject: "Five things worth reading", body: "1. Maps.", headers: "List-Unsubscribe: <mailto:unsub@thebrowser.com>", flags: ["\\Seen"], date: "Mon, 02 Nov 2026 08:00:00 +0000" };
const CODE = { from: "Acme <no-reply@acme.io>", subject: "Your sign-in code", body: "123456", date: "Tue, 03 Nov 2026 08:30:00 +0000" };
const REPLY = { from: "Test User <testuser@example.com>", subject: "Re: Onboarding review", body: "Will do.\n\nOn Mon, 2 Nov 2026 at 16:00, Priya Shah <priya@example.com> wrote:\n> Could you look at the onboarding flow before Thursday?", inReplyTo: "onboarding", flags: ["\\Seen"], date: "Mon, 02 Nov 2026 17:00:00 +0000" };
const OLD = { from: "Daniel <daniel@example.com>", subject: "Q3 retro notes", body: "In the wiki.", flags: ["\\Seen", "\\Flagged"], date: "Fri, 16 Oct 2026 10:00:00 +0000" };

async function setup(opts: { dir?: string } = {}) {
  const server = await imapServer({ inbox: [PRIYA, NEWS, CODE], sent: [REPLY], archive: [OLD] });
  cleanup.push(() => server.close());
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "mantou-mail-"));
  if (!opts.dir) cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { expungeDelay: 30 });
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail: Mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  return { server, store, remote, mail, dir };
}

async function addAccount(env: Awaited<ReturnType<typeof setup>>) {
  const a = await env.remote.addAccount({ email: "testuser@example.com", password: env.server.password, imap: env.server.settings, sender: "Test User" });
  await env.remote.syncOf(a.id)!.firstSync;
  return a;
}

const subjects = (mail: Mail) => mail.list().map((m) => m.subject);

test("adding an account replaces the sample mail with the server's, sorted into Important and Other", async () => {
  const env = await setup();
  const { mail } = env;
  expect(mail.accounts()[0].sample).toBe(true);
  await addAccount(env);
  expect(mail.accounts().map((a) => a.email)).toEqual(["testuser@example.com"]);
  expect(env.remote.statuses()["testuser@example.com"].state).toBe("ready");
  expect(subjects(mail)).toEqual(["Your sign-in code", "Onboarding review"]); // security mail is Important
  mail.setTab("other");
  expect(subjects(mail)).toEqual(["Five things worth reading"]);
  mail.setTab("important");
  const priya = mail.list().find((m) => m.subject === "Onboarding review")!;
  expect(priya).toMatchObject({ unread: true, starred: false, folder: "inbox", from: { name: "Priya Shah", email: "priya@example.com" } });
  expect(priya.body).toEqual(["Hi,", "Could you look at the onboarding flow before Thursday?", "Priya"]);
  mail.select(priya.id);
  // The reply in Sent is in the same conversation, without the quoted text.
  expect(mail.conversation().map((m) => m.body[0])).toEqual(["Hi,", "Will do."]);
  expect(mail.conversation()[1].body).toEqual(["Will do."]);
  mail.open({ kind: "folder", folder: "archive" });
  expect(mail.list()[0]).toMatchObject({ subject: "Q3 retro notes", starred: true, unread: false });
});

test("reading, starring, archiving and undo reach the server", async () => {
  const env = await setup();
  const { mail, server } = env;
  const a = await addAccount(env);
  const sync = env.remote.syncOf(a.id)!;
  const priya = mail.list().find((m) => m.subject === "Onboarding review")!;
  mail.select(priya.id); // opening it marks it read
  mail.star();
  await sync.settle();
  expect((await server.folder("INBOX")).find((m) => m.subject === "Onboarding review")!.flags).toEqual(["\\Flagged", "\\Seen"]);

  mail.archive();
  await sync.settle();
  expect((await server.folder("INBOX")).map((m) => m.subject)).not.toContain("Onboarding review");
  expect((await server.folder("Archive")).map((m) => m.subject)).toContain("Onboarding review");
  expect(mail.messages().find((m) => m.id === priya.id)).toMatchObject({ folder: "archive", remote: { path: "Archive" } }); // same message, new place

  mail.undo();
  await sync.settle();
  expect((await server.folder("INBOX")).map((m) => m.subject)).toContain("Onboarding review");
  expect(mail.list().map((m) => m.id)).toContain(priya.id);
});

test("delete forever waits for the undo window, then expunges", async () => {
  const env = await setup();
  const { mail, server } = env;
  const a = await addAccount(env);
  const sync = env.remote.syncOf(a.id)!;
  mail.select(mail.list().find((m) => m.subject === "Your sign-in code")!.id);
  mail.remove();
  await sync.settle();
  expect((await server.folder("Trash")).map((m) => m.subject)).toEqual(["Your sign-in code"]);
  mail.open({ kind: "folder", folder: "trash" });
  mail.remove(); // forever
  mail.undo(); // within the window: nothing happens on the server
  await Bun.sleep(60);
  await sync.settle();
  expect((await server.folder("Trash")).map((m) => m.subject)).toEqual(["Your sign-in code"]);
  mail.remove();
  await until(() => !sync["deletions"].size, "the undo window to pass");
  await sync.settle();
  expect(await server.folder("Trash")).toEqual([]);
});

test("new mail arrives while the app is open (IDLE)", async () => {
  const env = await setup();
  const { mail, server } = env;
  await addAccount(env);
  await server.deliver("INBOX", { from: "Alex Kim <alex@example.com>", subject: "Lisbon flights", body: "Cheap again!" });
  await until(() => subjects(mail).includes("Lisbon flights"), "the new message");
  expect(mail.unread({ kind: "all" })).toBe(3);
});

test("the saved copy shows at start, before (or without) a connection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const first = await setup({ dir });
  await addAccount(first);
  await first.remote.stop();
  first.store.close();
  await first.server.close();

  const store = new Store(dir);
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets());
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  expect(subjects(mail)).toEqual(["Your sign-in code", "Onboarding review"]);
  await remote.attach(mail);
  expect(remote.statuses()["testuser@example.com"].state).toBe("needs-password"); // the memory keychain forgot it
});

test("a wrong password is refused with the server's reason, and nothing is saved", async () => {
  const env = await setup();
  await expect(env.remote.addAccount({ email: "testuser@example.com", password: "nope", imap: env.server.settings })).rejects.toThrow(/didn't accept the password/);
  expect(env.remote.accounts()).toEqual([]);
  expect(env.mail.accounts()[0].sample).toBe(true);
});
