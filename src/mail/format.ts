// What a message says, as sent: the text the person wrote, quoting the message
// it answers, and an HTML version of it. The composer is plain text (Mantou has
// no rich text yet, dunkbing/mantou#15), so formatting is written the way
// people write it in plain text, a little Markdown, and sent as HTML too:
// **bold**, *italic* or _italic_, `code`, [links](https://…), bare links,
// "- " or "1. " lists, "> " quotes.
import type { Contact, Message } from "../data";

const who = (c: Contact) => (c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email);

/** "On Tue, 3 Nov 2026 at 09:12, Priya Shah <priya@northwind.dev> wrote:" */
export function attribution(m: Message): string {
  const d = m.date;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `On ${day} at ${time}, ${who(m.from)} wrote:`;
}

/** The plain text of a reply: what was written, then the original, quoted with "> ". */
export function replyText(body: string, original?: Message): string {
  if (!original) return body;
  const quoted = original.body.join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
  return `${body}\n\n${attribution(original)}\n${quoted}`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One line's inline formatting, as HTML (the text is escaped first). */
function inline(text: string): string {
  const codes: string[] = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}">${t}</a>`)
    .replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+[^\s<.,;:!?)'"])/g, (_, pre: string, u: string) => `${pre}<a href="${u}">${u}</a>`)
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** Whether the text uses any of the formatting above (else HTML adds nothing to it). */
export function hasFormatting(text: string): boolean {
  return /\*\*\S|(^|[^\w*])\*\S.*\S\*|(^|\W)_\S.*\S_|`[^`]+`|\[[^\]]+\]\((https?|mailto):|^\s*([-*]|\d+\.)\s+\S|^>\s?/m.test(text);
}

/** The text as HTML: paragraphs, lists, quotes and inline formatting. */
export function toHtml(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`).join("")}</ul>`);
    else if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`);
    else if (lines.every((l) => /^>/.test(l))) out.push(`<blockquote>${toHtml(lines.map((l) => l.replace(/^>\s?/, "")).join("\n"))}</blockquote>`);
    else out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
  }
  return out.join("\n");
}

const QUOTE_STYLE = "margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex";

/** The HTML of a reply: what was written, then the original in a blockquote. */
export function replyHtml(body: string, original?: Message): string {
  const html = `<div>${toHtml(body)}</div>`;
  if (!original) return html;
  const quoted = original.body.map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `${html}\n<div><p>${escape(attribution(original))}</p><blockquote style="${QUOTE_STYLE}">${quoted}</blockquote></div>`;
}
