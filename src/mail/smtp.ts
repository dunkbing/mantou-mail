// Sending: a message is built once as RFC 822 (nodemailer's composer), sent
// over SMTP, and the same bytes are filed in Sent over IMAP where the
// provider doesn't do that itself.
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { recipients, type Contact, type Message } from "../data";
import { isLocalHost, type SmtpSettings } from "./providers";
import { hasFormatting, replyHtml, replyText } from "./format";

const address = (c: Contact) => ({ name: c.name && c.name !== c.email ? c.name : "", address: c.email });

/** A Message-ID for mail sent from this address. */
export function newMessageId(from: string): string {
  return `${crypto.randomUUID()}@${from.split("@")[1] ?? "mantou.mail"}`;
}

/** An attachment's bytes, ready to go. */
export interface OutgoingFile {
  name: string;
  type: string;
  content: Uint8Array;
}

/**
 * The message as sent: RFC 822 bytes, with In-Reply-To and References when it
 * answers another, whose text it quotes. Written formatting goes in an HTML
 * version too (src/mail/format.ts). Bcc is left out, except in the copy for
 * Sent (`keepBcc`).
 */
export async function compose(m: Message, original?: Message, files: OutgoingFile[] = [], options: { keepBcc?: boolean } = {}): Promise<Buffer> {
  const refs = original?.messageId ? `<${original.messageId}>` : undefined;
  const body = m.body.join("\n\n");
  const mail = new MailComposer({
    from: address(m.from),
    to: (m.to ?? []).map(address),
    cc: (m.cc ?? []).map(address),
    bcc: (m.bcc ?? []).map(address),
    subject: m.subject,
    text: replyText(body, original),
    ...(original || hasFormatting(body) ? { html: replyHtml(body, original) } : {}),
    date: m.date,
    messageId: m.messageId ? `<${m.messageId}>` : undefined,
    inReplyTo: refs,
    references: refs,
    headers: { "X-Mailer": "Mantou Mail" },
    attachments: files.map((f) => ({ filename: f.name, contentType: f.type, content: Buffer.from(f.content) })),
  }).compile();
  mail.keepBcc = !!options.keepBcc;
  return mail.build();
}

function transport(s: SmtpSettings, password: string) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    // Without TLS from the start, STARTTLS is required: passwords never go in the clear (except to this machine).
    requireTLS: !s.secure && !isLocalHost(s.host),
    ignoreTLS: !s.secure && isLocalHost(s.host),
    auth: { user: s.user, pass: password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
  });
}

/** SMTP failures in words a person can act on. */
export function explainSmtp(e: unknown, s: SmtpSettings): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  // nodemailer reports socket errors as ESOCKET, with the system's code in the message.
  if (/ECONNREFUSED/.test(err.message ?? "")) return `${s.host} refused the connection on port ${s.port}`;
  if (/ENOTFOUND|EAI_AGAIN/.test(err.message ?? "")) return `Can't find ${s.host}: check the SMTP server name`;
  if (err.code === "EAUTH" || err.responseCode === 535) return `The SMTP server didn't accept the password${err.response ? `: ${err.response}` : ""}`;
  if (err.code === "EDNS" || err.code === "ENOTFOUND") return `Can't find ${s.host}: check the SMTP server name`;
  if (err.code === "ECONNECTION" || err.code === "ECONNREFUSED") return `${s.host} refused the connection on port ${s.port}`;
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKET") return `${s.host} didn't answer on port ${s.port}`;
  if (err.responseCode && err.response) return err.response;
  return err.message ?? String(e);
}

/** Logs in to the SMTP server once, for the Add account form; throws a readable error. */
export async function checkSmtp(s: SmtpSettings, password: string): Promise<void> {
  const t = transport(s, password);
  try {
    await t.verify();
  } catch (e) {
    throw new Error(explainSmtp(e, s));
  } finally {
    t.close();
  }
}

/** Sends the bytes to the message's recipients; throws a readable error. */
export async function send(s: SmtpSettings, password: string, m: Message, raw: Buffer): Promise<void> {
  const t = transport(s, password);
  try {
    await t.sendMail({ envelope: { from: m.from.email, to: recipients(m).map((c) => c.email) }, raw });
  } catch (e) {
    throw new Error(explainSmtp(e, s));
  } finally {
    t.close();
  }
}
