// From what IMAP gives (envelope, flags, the raw message) to the app's
// Message fields. Pure functions, so they're easy to test.
import { simpleParser, type AddressObject } from "mailparser";
import type { Attachment, Contact } from "../data";

export interface Parsed {
  from: Contact;
  to: Contact[];
  subject: string;
  body: string[];
  date: Date;
  /** People and security mail; newsletters, notifications and receipts are "Other". */
  important: boolean;
  messageId?: string;
  /** Messages with the same key are one conversation. */
  threadKey: string;
}

const addresses = (a: AddressObject | AddressObject[] | undefined): Contact[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((o) => o.value).flatMap(function flat(v): Contact[] {
    if (v.group) return v.group.flatMap(flat);
    return v.address ? [{ name: v.name || v.address, email: v.address }] : [];
  });

/** Senders that are machines, not people. */
const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|newsletters?|news|updates?|info|mailer-daemon|bounces?|marketing|hello|team|digest|alerts?)([+.\-_].*)?@/i;
/** Security mail goes to Important even from a machine (but not from a mailing list). */
const SECURITY = /\b(new sign[- ]?in|sign[- ]?in (code|attempt)|log[- ]?in (code|attempt)|verification code|security (alert|code)|verify your|password reset|reset your password|one-time (code|password)|two-factor|2-step|2fa|your (login|sign[- ]?in|security) code)\b/i;

export function isImportant(fromEmail: string, subject: string, headers: Map<string, unknown>): boolean {
  // mailparser keeps List-* headers together under "list".
  if (headers.has("list") || headers.has("list-unsubscribe") || headers.has("list-id")) return false;
  const precedence = String(headers.get("precedence") ?? "").toLowerCase();
  if (["bulk", "list", "junk"].includes(precedence)) return false;
  if (SECURITY.test(subject)) return true;
  const auto = String(headers.get("auto-submitted") ?? "no").toLowerCase();
  if (auto !== "no") return false;
  return !AUTOMATED.test(fromEmail);
}

/**
 * The text of a message as paragraphs, without the quoted history replies
 * carry ("On … wrote:" and what follows, "> " lines), since the reader
 * shows the conversation's earlier messages itself.
 */
export function paragraphsOf(text: string): string[] {
  let t = text.replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const cuts = [
    /^On .{0,300}(\n.{0,200})?wrote:\s*$/m, // Gmail, Apple Mail (sometimes wrapped onto two lines)
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im, // Outlook
    /^_{10,}\s*\nFrom: /m, // Outlook on the web
    /^From: .+\n(Sent|Date): .+\n(To|Subject): /m,
  ];
  for (const re of cuts) {
    const m = re.exec(t);
    if (m && m.index > 0) t = t.slice(0, m.index);
  }
  // Trailing quoted lines (and the blank lines between them).
  const lines = t.split("\n");
  while (lines.length && (/^\s*>/.test(lines.at(-1)!) || !lines.at(-1)!.trim())) lines.pop();
  t = lines.join("\n").slice(0, 60_000);
  return t
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim())
    .slice(0, 300);
}

const angle = (id: string) => id.trim().replace(/^<|>$/g, "");

/** The conversation: the server's thread id where it has one, else the first message of References. */
export function threadKeyOf(opts: { serverThreadId?: string; messageId?: string; inReplyTo?: string; references?: string[] }, fallback: string): string {
  if (opts.serverThreadId) return `t:${opts.serverThreadId}`;
  const root = opts.references?.[0] ?? opts.inReplyTo ?? opts.messageId;
  return root ? `m:${angle(root)}` : fallback;
}

/** Parses a raw message (as fetched with `source`). */
export async function parseMessage(source: Buffer | string, opts: { serverThreadId?: string; internalDate?: Date; fallbackKey: string }): Promise<Parsed> {
  const p = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const from = addresses(p.from)[0] ?? { name: "(unknown sender)", email: "" };
  const subject = (p.subject ?? "").trim();
  const refs = Array.isArray(p.references) ? p.references : p.references ? p.references.split(/\s+/) : [];
  return {
    from,
    to: [...addresses(p.to), ...addresses(p.cc)],
    subject,
    body: paragraphsOf(p.text ?? ""),
    date: p.date ?? opts.internalDate ?? new Date(),
    important: isImportant(from.email, subject, p.headers as Map<string, unknown>),
    messageId: p.messageId ? angle(p.messageId) : undefined,
    threadKey: threadKeyOf({ serverThreadId: opts.serverThreadId, messageId: p.messageId, inReplyTo: p.inReplyTo, references: refs }, opts.fallbackKey),
  };
}

/** A MIME part as imapflow describes it (FETCH BODYSTRUCTURE). */
export interface StructurePart {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  disposition?: string;
  id?: string;
  encoding?: string;
  size?: number;
  childNodes?: StructurePart[];
}

/**
 * A message's attachments from its structure: parts sent as attachments, and
 * named parts that aren't the text. Inline images with a Content-ID belong
 * to the HTML, not the list. Nothing is downloaded: each keeps its part.
 */
export function attachmentsOf(root: StructurePart | undefined): Attachment[] {
  const out: Attachment[] = [];
  const walk = (n: StructurePart) => {
    if (n.childNodes?.length) return n.childNodes.forEach(walk);
    const type = (n.type ?? "application/octet-stream").toLowerCase();
    const name = n.dispositionParameters?.filename ?? n.parameters?.name;
    const inlineImage = n.disposition === "inline" && !!n.id;
    const isAttachment = n.disposition === "attachment" || (!!name && !/^text\/(plain|html)$/.test(type) && !inlineImage);
    if (!isAttachment || n === root) return;
    // A base64 part's bytes are about 3/4 of its encoded size.
    const size = Math.round((n.size ?? 0) * ((n.encoding ?? "").toLowerCase() === "base64" ? 0.74 : 1));
    out.push({ name: name || `attachment ${out.length + 1}`, type, size, part: n.part ?? "1" });
  };
  if (root) walk(root);
  return out;
}
