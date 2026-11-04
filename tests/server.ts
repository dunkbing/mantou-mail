// An IMAP server in the test process (hoodiecrow), with Gmail-like folders,
// and a second client to look at what the server has.
import hoodiecrow from "hoodiecrow-imap";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import type { ImapSettings } from "../src/mail/providers";

export interface Mail {
  from: string;
  subject: string;
  body: string;
  date?: string;
  id?: string;
  inReplyTo?: string;
  headers?: string;
  flags?: string[];
}

export const raw = (m: Mail) =>
  [
    `From: ${m.from}`,
    `To: Test User <testuser@example.com>`,
    `Subject: ${m.subject}`,
    `Message-ID: <${m.id ?? Math.random().toString(36).slice(2)}@example.com>`,
    ...(m.inReplyTo ? [`In-Reply-To: <${m.inReplyTo}@example.com>`, `References: <${m.inReplyTo}@example.com>`] : []),
    `Date: ${m.date ?? "Tue, 03 Nov 2026 09:00:00 +0000"}`,
    ...(m.headers ? [m.headers] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    m.body,
    "",
  ].join("\r\n");

const box = (msgs: Mail[] = []) => ({ messages: msgs.map((m) => ({ raw: raw(m), flags: m.flags ?? [] })) });

export async function imapServer(folders: { inbox?: Mail[]; archive?: Mail[]; sent?: Mail[]; trash?: Mail[]; drafts?: Mail[] }) {
  const server = hoodiecrow({
    plugins: ["IDLE", "SPECIAL-USE", "MOVE", "UIDPLUS", "ENABLE", "CONDSTORE", "ID", "UNSELECT"],
    storage: {
      INBOX: box(folders.inbox),
      "": {
        separator: "/",
        folders: {
          Archive: { "special-use": "\\Archive", ...box(folders.archive) },
          Sent: { "special-use": "\\Sent", ...box(folders.sent) },
          Trash: { "special-use": "\\Trash", ...box(folders.trash) },
          Drafts: { "special-use": "\\Drafts", ...box(folders.drafts) },
        },
      },
    },
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s: import("node:net").Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const settings: ImapSettings = { host: "127.0.0.1", port, secure: false, user: "testuser" };
  const smtp = await smtpServer();
  const inspector = new ImapFlow({ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" }, logger: false });
  inspector.on("error", () => {});
  await inspector.connect();
  return {
    settings,
    /** Mail sent to this server's SMTP side. */
    smtp,
    password: "testpass",
    /** Subjects and flags of a folder's messages, as the server has them. */
    async folder(path: string) {
      // Selected afresh each time: a session that has the folder open hears of others' changes only later.
      if (inspector.mailbox) await inspector.mailboxClose();
      const lock = await inspector.getMailboxLock(path);
      try {
        const out: { subject: string; flags: string[] }[] = [];
        if ((inspector.mailbox as { exists: number }).exists) {
          for await (const m of inspector.fetch("1:*", { envelope: true, flags: true })) out.push({ subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])].sort() });
        }
        return out;
      } finally {
        lock.release();
      }
    },
    async deliver(path: string, m: Mail) {
      await inspector.append(path, raw(m), m.flags ?? []);
    },
    async close() {
      await smtp.close();
      await inspector.logout().catch(() => inspector.close());
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
    /** The server goes away at once, connections and all (the network went down). */
    async drop() {
      await smtp.close();
      inspector.close();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Waits for a condition (not for a time), stepping a headless core while it waits, if there is one. */
export async function until(cond: () => boolean, what: string, step?: () => void, ms = 5_000) {
  const end = Date.now() + ms;
  for (;;) {
    step?.();
    if (cond()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

/** An SMTP server in the test process: it checks the password and keeps what it receives. */
export async function smtpServer(password = "testpass") {
  const received: { from: string; to: string[]; raw: string }[] = [];
  const server = new SMTPServer({
    logger: false,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, done) {
      done(auth.password === password ? null : Object.assign(new Error("Invalid credentials"), { responseCode: 535 }), { user: auth.username });
    },
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString() });
        done();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.server.address() as { port: number }).port;
  return {
    settings: { host: "127.0.0.1", port, secure: false, user: "testuser" },
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
