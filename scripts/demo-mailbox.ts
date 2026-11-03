// The sample mail as an IMAP server's storage (hoodiecrow): real RFC 822
// messages with Message-IDs and References for the conversations, flags, and
// list headers on newsletters. Used by `bun run demo-server` and screenshots.
import { sampleMessages, type Message } from "../src/data";

const ME = { name: "Sam Rivera", email: "sam@northwind.dev" };

const header = (c: { name: string; email: string }) => (c.name && c.name !== c.email ? `"${c.name}" <${c.email}>` : c.email);
const rfcDate = (d: Date) => d.toUTCString().replace("GMT", "+0000");

function raw(m: Message, thread: Map<number | string, string>, ids: Map<number, string>): string {
  const id = ids.get(m.id)!;
  const root = m.thread !== undefined ? thread.get(m.thread) : undefined;
  const lines = [
    `From: ${header(m.from)}`,
    `To: ${m.to?.length ? m.to.map(header).join(", ") : header(ME)}`,
    `Subject: ${m.subject}`,
    `Date: ${rfcDate(m.date)}`,
    `Message-ID: <${id}>`,
    ...(root && root !== id ? [`In-Reply-To: <${root}>`, `References: <${root}>`] : []),
    ...(m.important ? [] : ["List-Unsubscribe: <mailto:unsubscribe@example.com>"]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    m.body.join("\r\n\r\n"),
    "",
  ];
  return lines.join("\r\n");
}

/** Hoodiecrow storage for the sample mail of one sample account (default: Work). */
export function demoStorage(account = "work") {
  const msgs = sampleMessages().filter((m) => m.account === account && m.folder !== "snoozed" && m.folder !== "drafts");
  const ids = new Map(msgs.map((m) => [m.id, `${m.id}.${account}@demo.mantou`]));
  // A conversation's first message (by date) is the root the others refer to.
  const thread = new Map<number | string, string>();
  for (const m of [...msgs].sort((a, b) => a.date.getTime() - b.date.getTime())) if (m.thread !== undefined && !thread.has(m.thread)) thread.set(m.thread, ids.get(m.id)!);
  const box = (folder: Message["folder"]) => ({
    messages: msgs.filter((m) => m.folder === folder).map((m) => ({
      raw: raw(m, thread, ids),
      flags: [...(m.unread ? [] : ["\\Seen"]), ...(m.starred ? ["\\Flagged"] : [])],
      internaldate: m.date,
    })),
  });
  return {
    INBOX: box("inbox"),
    "": {
      separator: "/",
      folders: {
        Archive: { "special-use": "\\Archive", ...box("archive") },
        Sent: { "special-use": "\\Sent", ...box("sent") },
        Drafts: { "special-use": "\\Drafts", messages: [] },
        Trash: { "special-use": "\\Trash", ...box("trash") },
      },
    },
  };
}

export const DEMO_PLUGINS = ["IDLE", "SPECIAL-USE", "MOVE", "UIDPLUS", "ENABLE", "CONDSTORE", "ID", "UNSELECT"];
