// An IMAP server in the test process (hoodiecrow), with Gmail-like folders,
// and a second client to look at what the server has.
import hoodiecrow from "hoodiecrow-imap";
import { ImapFlow } from "imapflow";
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const settings: ImapSettings = { host: "127.0.0.1", port, secure: false, user: "testuser" };
  const inspector = new ImapFlow({ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" }, logger: false });
  inspector.on("error", () => {});
  await inspector.connect();
  return {
    settings,
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
      await inspector.logout().catch(() => inspector.close());
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
