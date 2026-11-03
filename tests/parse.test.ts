// From raw mail to the app's fields, and settings guessed from an address.
import { expect, test } from "bun:test";
import { isImportant, paragraphsOf, parseMessage, threadKeyOf } from "../src/mail/parse";
import { guessSettings, providerFor } from "../src/mail/providers";

test("quoted history is cut from replies; paragraphs split at blank lines", () => {
  expect(paragraphsOf("Sounds good.\r\n\r\nSee you then,\r\nSam\r\n\r\nOn Mon, 2 Nov 2026 at 16:00, Priya <p@x.io> wrote:\r\n> Lunch?\r\n")).toEqual(["Sounds good.", "See you then,\nSam"]);
  expect(paragraphsOf("Yes.\n\n-----Original Message-----\nFrom: Jonas")).toEqual(["Yes."]);
  expect(paragraphsOf("Fine by me\n\n> earlier\n> text\n")).toEqual(["Fine by me"]);
  expect(paragraphsOf("On a related note, I wrote: this stays")).toEqual(["On a related note, I wrote: this stays"]); // only a line of its own is a cut
});

test("Important is people and security mail; lists and machines are Other", () => {
  const h = (o: Record<string, string> = {}) => new Map(Object.entries(o));
  expect(isImportant("priya@example.com", "Lunch?", h())).toBe(true);
  expect(isImportant("hello@thebrowser.com", "Five things", h({ "list-unsubscribe": "<mailto:x>" }))).toBe(false);
  expect(isImportant("noreply@github.com", "Release ready", h())).toBe(false);
  expect(isImportant("no-reply@acme.io", "Your sign-in code", h())).toBe(true);
  expect(isImportant("team@linear.app", "Weekly digest", h({ precedence: "bulk" }))).toBe(false);
  expect(isImportant("security@northwind.dev", "New sign-in to your account from Berlin", h())).toBe(true);
  expect(isImportant("notifications@linear.app", "NW-482 moved to In Review: Workspace picker after sign-in", h())).toBe(false); // not security mail
});

test("List-* headers make a message Other, as mailparser reports them", async () => {
  const raw = "From: Stripe <receipts@stripe.com>\r\nSubject: Your receipt\r\nList-Unsubscribe: <mailto:u@stripe.com>\r\n\r\nAmount paid: $180.00\r\n";
  expect((await parseMessage(raw, { fallbackKey: "x" })).important).toBe(false);
});

test("an HTML-only message is shown as text", async () => {
  const raw = [
    "From: Figma <no-reply@figma.com>",
    "To: sam@example.com",
    "Subject: Priya commented",
    "Message-ID: <c1@figma.com>",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body><p>Priya commented on <b>Onboarding v7</b>:</p><p>&ldquo;Try the illustration at 80%.&rdquo;</p></body></html>",
  ].join("\r\n");
  const p = await parseMessage(raw, { fallbackKey: "x" });
  expect(p.body.join("\n")).toContain("Priya commented on Onboarding v7");
  expect(p.body.join("\n")).toContain("“Try the illustration at 80%.”");
  expect(p).toMatchObject({ subject: "Priya commented", important: false, messageId: "c1@figma.com", from: { name: "Figma", email: "no-reply@figma.com" } });
});

test("conversations: the server's thread id, else the first reference", () => {
  expect(threadKeyOf({ serverThreadId: "1834" }, "f")).toBe("t:1834");
  expect(threadKeyOf({ messageId: "<b@x>", references: ["<a@x>", "<b@x>"] }, "f")).toBe("m:a@x");
  expect(threadKeyOf({ messageId: "<a@x>" }, "f")).toBe("m:a@x");
  expect(threadKeyOf({}, "fallback")).toBe("fallback");
});

test("IMAP settings are guessed from the address", () => {
  expect(guessSettings("sam@gmail.com")).toEqual({ host: "imap.gmail.com", port: 993, secure: true, user: "sam@gmail.com" });
  expect(guessSettings("sam@hotmail.co.uk").host).toBe("outlook.office365.com");
  expect(guessSettings("sam@me.com").host).toBe("imap.mail.me.com");
  expect(guessSettings("sam@northwind.dev").host).toBe("imap.northwind.dev");
  expect(providerFor("sam@fastmail.com")?.passwordHint).toMatch(/app password/);
});
