// Real accounts against an IMAP server in the test process: the first sync,
// the user's changes reaching the server, new mail arriving, and the saved copy.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { now } from "../src/data";
import { Blobs } from "../src/mail/blobs";
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
  const remote = new Remote(store, memorySecrets(), { expungeDelay: 30, undoSend: 30 });
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail: Mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  await remote.attach(mail);
  return { server, store, remote, mail, dir };
}

async function addAccount(env: Awaited<ReturnType<typeof setup>>) {
  const a = await env.remote.addAccount({ email: "testuser@example.com", password: env.server.password, imap: env.server.settings, smtp: env.server.smtp.settings, sender: "Test User" });
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
  await expect(env.remote.addAccount({ email: "testuser@example.com", password: "nope", imap: env.server.settings, smtp: env.server.smtp.settings })).rejects.toThrow(/didn't accept the password/);
  expect(env.remote.accounts()).toEqual([]);
  expect(env.mail.accounts()[0].sample).toBe(true);
});

test("changes made offline survive a quit, and reach the server on the next start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const first = await setup({ dir });
  const a = await addAccount(first);
  await first.server.drop(); // offline
  await until(() => first.remote.statuses()[a.id].state === "offline", "going offline");
  first.mail.select(first.mail.list().find((m) => m.subject === "Onboarding review")!.id);
  first.mail.archive(); // can't reach the server: kept
  expect(first.store.pending(a.id).map((p) => (p.op as { kind: string }).kind)).toContain("move");
  await first.remote.stop();
  first.store.close();

  // Next start: the network is back (a new server, as it was before the change).
  const server = await imapServer({ inbox: [PRIYA, NEWS, CODE], sent: [REPLY], archive: [OLD] });
  cleanup.push(() => server.close());
  const store = new Store(dir);
  cleanup.push(() => store.close());
  store.saveAccount({ ...store.accounts()[0], imap: server.settings, smtp: server.smtp.settings });
  const secrets = memorySecrets();
  await secrets.set(a.id, server.password);
  const remote = new Remote(store, secrets);
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  expect(subjects(mail)).toEqual(["Your sign-in code"]); // archived here already
  await remote.attach(mail);
  await remote.syncOf(a.id)!.firstSync;
  expect((await server.folder("Archive")).map((m) => m.subject)).toContain("Onboarding review");
  expect((await server.folder("INBOX")).map((m) => m.subject)).not.toContain("Onboarding review");
  expect(store.pending(a.id)).toEqual([]);
  expect(subjects(mail)).toEqual(["Your sign-in code"]);
});

test("older mail beyond the kept window comes on request, and stays kept", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ from: `Person ${i} <p${i}@example.com>`, subject: `Message ${i + 1}`, body: "Hello", date: `Tue, 03 Nov 2026 0${i}:00:00 +0000` }));
  const server = await imapServer({ inbox: many });
  cleanup.push(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { window: 5 });
  cleanup.push(() => remote.stop());
  const mail = createMail([], { accounts: [], onChange: remote.onChange });
  await remote.attach(mail);
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings });
  await remote.syncOf(a.id)!.firstSync;
  expect(subjects(mail)).toEqual(["Message 8", "Message 7", "Message 6", "Message 5", "Message 4"]);
  expect(remote.olderCount({ kind: "all" })).toBe(3);
  expect(remote.olderCount({ kind: "starred" })).toBe(0);
  await remote.loadOlder({ kind: "all" });
  expect(subjects(mail).length).toBe(8);
  expect(remote.olderCount({ kind: "all" })).toBe(0);
  expect(store.window(a.id, "inbox", 5)).toBe(10); // kept from now on, also after a restart
});

test("sending: the outbox waits for Undo Send, then SMTP; the message is filed in Sent once", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  mail.compose();
  mail.editDraft({ to: "Jonas Weber <jonas@example.com>", subject: "Renewal call", body: "Hi Jonas,\n\nThe 15th works. 10:00?" });
  expect(mail.send()).toBe(true);
  expect(mail.status()).toBe("Sending to Jonas Weber");
  expect(mail.messages().find((m) => m.subject === "Renewal call")).toMatchObject({ folder: "sent", outbox: {} });
  await until(() => server.smtp.received.length === 1, "the SMTP server to receive it");
  const got = server.smtp.received[0];
  expect(got.to).toEqual(["jonas@example.com"]);
  expect(got.raw).toContain("Subject: Renewal call");
  expect(got.raw).toMatch(/From: Test User <testuser@example.com>/);
  expect(got.raw).toContain("The 15th works. 10:00?");
  await remote.outboxEmpty();
  await until(() => mail.messages().some((m) => m.subject === "Renewal call" && m.remote?.path === "Sent"), "the server's copy in Sent");
  expect((await server.folder("Sent")).map((m) => m.subject)).toContain("Renewal call");
  expect(mail.messages().filter((m) => m.subject === "Renewal call").length).toBe(1); // the local copy gave way
  expect(mail.status()).toBe("Sent to Jonas Weber");
});

test("a reply is sent with In-Reply-To and References, so it threads everywhere", async () => {
  const env = await setup();
  const { mail, server } = env;
  await addAccount(env);
  mail.select(mail.list().find((m) => m.subject === "Onboarding review")!.id);
  mail.toggleReply();
  mail.editDraft({ body: "Will look tonight." });
  mail.send();
  await until(() => server.smtp.received.length === 1, "the reply");
  expect(server.smtp.received[0].raw).toContain("In-Reply-To: <onboarding@example.com>");
  expect(server.smtp.received[0].raw).toContain("Subject: Re: Onboarding review");
  expect(server.smtp.received[0].to).toEqual(["priya@example.com"]);
});

test("reply all over SMTP: Cc in the headers, Bcc only in the envelope (and in Sent's copy); the original quoted, with an HTML part", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  await server.deliver("INBOX", { from: "Priya Shah <priya@example.com>", subject: "Launch plan", body: "Thoughts on Tuesday?\n\nPriya", id: "launch", headers: "Cc: Mira Kowalski <mira@example.com>, Test User <testuser@example.com>" });
  await until(() => mail.messages().some((m) => m.subject === "Launch plan"), "the message");
  const launch = mail.messages().find((m) => m.subject === "Launch plan")!;
  expect(launch.cc).toEqual([{ name: "Mira Kowalski", email: "mira@example.com" }, { name: "Test User", email: "testuser@example.com" }]);
  mail.select(launch.id);
  mail.toggleReply(true);
  expect(mail.draft()).toMatchObject({ to: "Priya Shah <priya@example.com>", cc: "Mira Kowalski <mira@example.com>" }); // not you
  mail.editDraft({ bcc: "daniel@example.com", body: "Tuesday is **great**. Agenda:\n\n- launch\n- metrics" });
  mail.send();
  await until(() => server.smtp.received.length === 1, "the reply");
  const got = server.smtp.received[0];
  expect(got.to.sort()).toEqual(["daniel@example.com", "mira@example.com", "priya@example.com"]);
  expect(got.raw).toContain("Cc: Mira Kowalski <mira@example.com>");
  expect(got.raw).not.toMatch(/^Bcc:/m);
  expect(got.raw).toContain("> Thoughts on Tuesday?"); // the text part quotes the original
  expect(got.raw).toMatch(/On \w{3}, \d+ \w{3} 2026 at \d\d:\d\d, Priya Shah <priya@example.com> wrote:/);
  expect(got.raw).toContain("Content-Type: text/html");
  expect(got.raw.replace(/=\r?\n/g, "")).toContain("<strong>great</strong>");
  await remote.outboxEmpty();
  await until(() => mail.messages().some((m) => m.subject === "Re: Launch plan" && m.remote?.path === "Sent"), "the copy in Sent");
  const sent = mail.messages().find((m) => m.subject === "Re: Launch plan")!;
  expect(sent.bcc).toEqual([{ name: "Daniel", email: "daniel@example.com" }]); // Sent's copy keeps the Bcc line (named from his earlier mail)
  expect(sent.body).toEqual(["Tuesday is **great**. Agenda:", "- launch\n- metrics"]); // the quote is folded away when read
});

test("an account's signature goes under what's sent from it, not into the draft", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  const a = await addAccount(env);
  remote.setSignature(a.id, "Best,\nSam");
  mail.compose();
  mail.editDraft({ to: "jonas@example.com", subject: "Hello", body: "See you Tuesday." });
  mail.send();
  await until(() => server.smtp.received.length === 1, "the message to arrive");
  expect(server.smtp.received[0].raw).toMatch(/See you Tuesday\.\r?\n\r?\n-- \r?\nBest,\r?\nSam/);
  expect(mail.messages().find((m) => m.subject === "Hello")!.body).toEqual(["See you Tuesday."]);
});

test("Undo Send within the window sends nothing, and puts the text back in Drafts", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  mail.compose();
  mail.editDraft({ to: "alex@example.com", subject: "Lisbon", body: "Booked!" });
  mail.send();
  mail.undo();
  await Bun.sleep(80); // past the 30 ms window
  await remote.outboxEmpty();
  expect(server.smtp.received).toEqual([]);
  expect(mail.messages().find((m) => m.subject === "Lisbon")).toMatchObject({ folder: "drafts", body: ["Booked!"] });
});

test("a draft is kept in the server's Drafts, replaced when it's edited, and removed when it's sent", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  // Waits for the server's Drafts to hold exactly these subjects.
  const draftsAre = async (...subjects: string[]) => {
    const end = Date.now() + 5_000;
    for (;;) {
      const got = (await server.folder("Drafts")).map((m) => m.subject);
      if (got.join("|") === subjects.join("|")) return;
      if (Date.now() > end) throw new Error(`timed out waiting for Drafts to hold [${subjects}]; it has [${got}]`);
      await Bun.sleep(10);
    }
  };
  mail.compose();
  mail.editDraft({ to: "alex@example.com", subject: "Lisbon", body: "Booked!" });
  mail.closeCompose();
  await draftsAre("Lisbon");
  expect((await server.folder("Drafts"))[0].flags).toEqual(["\\Draft", "\\Seen"]);
  await until(() => mail.messages().filter((m) => m.folder === "drafts").length === 1, "one draft shown");
  mail.compose(mail.messages().find((m) => m.folder === "drafts"));
  mail.editDraft({ subject: "Lisbon trip" });
  mail.closeCompose();
  await draftsAre("Lisbon trip");
  expect(mail.messages().filter((m) => m.folder === "drafts").length).toBe(1); // the server's copy isn't a second draft
  mail.compose(mail.messages().find((m) => m.folder === "drafts"));
  mail.send();
  await remote.outboxEmpty();
  await draftsAre();
  expect(mail.messages().filter((m) => m.folder === "drafts").length).toBe(0);
});

test("a message that can't be sent goes back to Drafts, with the reason", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  await server.smtp.close(); // the SMTP server is gone
  mail.compose();
  mail.editDraft({ to: "alex@example.com", subject: "Lisbon", body: "Booked!" });
  mail.send();
  await remote.outboxEmpty();
  expect(mail.messages().find((m) => m.subject === "Lisbon")).toMatchObject({ folder: "drafts", outbox: undefined, draft: { to: "alex@example.com" } });
  expect(mail.status()).toMatch(/^Couldn't send “Lisbon”: .*refused the connection.*It's in Drafts\.$/);
});

// ---------------------------------------------------------------- attachments

const PDF = "%PDF-1.4\n% a small test file\n";
async function withAttachment() {
  const MailComposer = (await import("nodemailer/lib/mail-composer")).default;
  return (await new MailComposer({
    from: "Daniel Okafor <daniel@example.com>", to: "testuser@example.com", subject: "Q4 OKRs", messageId: "<okrs@example.com>",
    date: new Date("2026-11-03T08:00:00Z"), text: "Draft attached.",
    attachments: [{ filename: "q4-okrs.pdf", content: Buffer.from(PDF), contentType: "application/pdf" }],
  }).compile().build()).toString();
}

async function attachmentEnv() {
  const server = await imapServer({ inbox: [{ from: "", subject: "", body: "", raw: await withAttachment() }] });
  cleanup.push(() => server.close());
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const opened: string[] = [];
  const store = new Store(dir);
  cleanup.push(() => store.close());
  const remote = new Remote(store, memorySecrets(), { undoSend: 20, blobs: new Blobs(join(dir, "blobs")), downloads: dir, open: (p) => opened.push(p) });
  cleanup.push(() => remote.stop());
  const mail = createMail([], { accounts: [], onChange: remote.onChange });
  await remote.attach(mail);
  const a = await remote.addAccount({ email: "testuser@example.com", password: server.password, imap: server.settings, smtp: server.smtp.settings, sender: "Test User" });
  await remote.syncOf(a.id)!.firstSync;
  return { server, remote, mail, dir, opened };
}

test("a received attachment is listed from the message's structure, and downloaded when it's opened", async () => {
  const { remote, mail, dir, opened } = await attachmentEnv();
  const m = mail.list()[0];
  expect(m.attachments).toEqual([{ name: "q4-okrs.pdf", type: "application/pdf", size: expect.any(Number), part: "2" }]);
  expect(Math.abs(m.attachments![0].size - PDF.length)).toBeLessThan(10); // from the encoded size, not a download
  const path = await remote.openAttachment(m, m.attachments![0]);
  expect(path).toBe(join(dir, "q4-okrs.pdf"));
  expect(await Bun.file(path).text()).toBe(PDF);
  expect(opened).toEqual([path]);
  expect(mail.list()[0].attachments![0].blob).toMatch(/^[0-9a-f]{64}$/); // kept: it opens offline next time
  expect(await remote.openAttachment(mail.list()[0], mail.list()[0].attachments![0])).toBe(join(dir, "q4-okrs (2).pdf"));
});

test("sending with an attachment, and forwarding one that's still on the server", async () => {
  const { server, remote, mail, dir } = await attachmentEnv();
  const file = join(dir, "usage.csv");
  await Bun.write(file, "month,seats\n2026-10,238\n");
  mail.compose();
  mail.editDraft({ to: "jonas@example.com", subject: "Usage", body: "Attached." });
  mail.addAttachments(await remote.attachFiles([file]));
  expect(mail.draft().attachments).toMatchObject([{ name: "usage.csv", type: "text/csv", size: 24 }]);
  mail.send();
  await until(() => server.smtp.received.length === 1, "the message with its attachment");
  expect(server.smtp.received[0].raw).toMatch(/Content-Disposition: attachment; filename=usage\.csv/);
  expect(server.smtp.received[0].raw).toContain(Buffer.from("month,seats\n2026-10,238\n").toString("base64"));

  mail.open({ kind: "all" });
  mail.select(mail.list().find((m) => m.subject === "Q4 OKRs")!.id);
  mail.forward();
  expect(mail.composing()).toBe(true);
  expect(mail.draft()).toMatchObject({ subject: "Fwd: Q4 OKRs", to: "" });
  expect(mail.draft().body).toContain("---------- Forwarded message ----------\nFrom: Daniel Okafor <daniel@example.com>");
  expect(mail.draft().body).toContain("Draft attached.");
  mail.editDraft({ to: "priya@example.com" });
  mail.send();
  await until(() => server.smtp.received.length === 2, "the forward");
  const fwd = server.smtp.received[1].raw;
  expect(fwd).toContain("Subject: Fwd: Q4 OKRs");
  expect(fwd).toMatch(/filename=q4-okrs\.pdf/);
  expect(fwd).toContain(Buffer.from(PDF).toString("base64")); // downloaded from the server's copy to go along
  await remote.outboxEmpty();
});

// ---------------------------------------------------------------- Send Later

const soon = (ms: number) => new Date(now().getTime() + ms); // the tests' clock is fixed: this is ms from "now"

test("Send Later: a real account's message is sent at its time, over SMTP, and filed in Sent", async () => {
  const env = await setup();
  const { mail, server, remote } = env;
  await addAccount(env);
  mail.compose();
  mail.editDraft({ to: "jonas@example.com", subject: "Later", body: "Sent at its time." });
  expect(mail.send(soon(80))).toBe(true);
  expect(mail.messages().find((m) => m.subject === "Later")).toMatchObject({ folder: "scheduled", outbox: { at: soon(80).toISOString() } });
  await Bun.sleep(30);
  expect(server.smtp.received).toEqual([]); // not before its time
  await until(() => server.smtp.received.length === 1, "its time");
  await remote.outboxEmpty();
  await until(() => mail.messages().some((m) => m.subject === "Later" && m.remote?.path === "Sent"), "the copy in Sent");
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(0);
});

test("deleting a scheduled message cancels it; one scheduled when the app stops goes after the next start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mantou-mail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const first = await setup({ dir });
  const a = await addAccount(first);
  first.mail.compose();
  first.mail.editDraft({ to: "jonas@example.com", subject: "Cancelled", body: "Never sent." });
  first.mail.send(soon(60));
  first.mail.open({ kind: "folder", folder: "scheduled" });
  first.mail.remove();
  expect(first.mail.messages().find((m) => m.subject === "Cancelled")).toMatchObject({ folder: "trash", outbox: undefined });
  first.mail.compose();
  first.mail.editDraft({ to: "jonas@example.com", subject: "After a restart", body: "Kept." });
  first.mail.send(soon(60));
  await first.remote.stop(); // before its time
  await Bun.sleep(100);
  expect(first.server.smtp.received).toEqual([]);
  first.store.close();

  const store = new Store(dir);
  cleanup.push(() => store.close());
  const secrets = memorySecrets();
  await secrets.set(a.id, first.server.password);
  const remote = new Remote(store, secrets);
  cleanup.push(() => remote.stop());
  const start = remote.initial();
  const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
  expect(mail.count({ kind: "folder", folder: "scheduled" })).toBe(1);
  await remote.attach(mail);
  await until(() => first.server.smtp.received.length === 1, "the scheduled message");
  expect(first.server.smtp.received[0].raw).toContain("Subject: After a restart");
});
