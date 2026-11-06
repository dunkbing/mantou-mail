// What a message says, as sent: the text the person wrote, quoting the message
// it answers, and an HTML version of it. The composer is plain text (Mantou has
// no rich text yet, dunkbing/mantou#15), so formatting is written the way
// people write it in plain text, a little Markdown, and sent as HTML too:
// **bold**, *italic* or _italic_, `code`, [links](https://…), bare links,
// "- " or "1. " lists, "> " quotes. The composer's format bar writes these (`applyFormat`).
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

export type Format = "bold" | "italic" | "code" | "link" | "bullets" | "numbers" | "quote";
export interface Edit {
  text: string;
  start: number;
  end: number;
}

const WRAP: Record<"bold" | "italic" | "code", string> = { bold: "**", italic: "*", code: "`" };
const PREFIX: Record<"bullets" | "numbers" | "quote", RegExp> = { bullets: /^[-*] /, numbers: /^\d+\. /, quote: /^> ?/ };

/**
 * The text after a formatting button or shortcut, written as the Markdown above, and where the selection goes.
 * Pressing it again undoes it: wrapped text is unwrapped, lines that all have the prefix lose it.
 */
export function applyFormat(text: string, sel: { start: number; end: number }, kind: Format): Edit {
  const { start, end } = sel;
  if (kind === "bold" || kind === "italic" || kind === "code") {
    const m = WRAP[kind];
    const before = text.slice(Math.max(0, start - m.length), start);
    const after = text.slice(end, end + m.length);
    // "**bold**" selected with its markers, or just the word between them
    if (before === m && after === m && (kind !== "italic" || text[start - 2] !== "*")) {
      return { text: text.slice(0, start - m.length) + text.slice(start, end) + text.slice(end + m.length), start: start - m.length, end: end - m.length };
    }
    return { text: text.slice(0, start) + m + text.slice(start, end) + m + text.slice(end), start: start + m.length, end: end + m.length };
  }
  if (kind === "link") {
    const label = text.slice(start, end);
    const url = "https://";
    const out = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
    // a label already there: the address is what's left to type; else the label is
    return label ? { text: out, start: start + label.length + 3, end: start + label.length + 3 + url.length } : { text: out, start: start + 1, end: start + 1 };
  }
  // lists and quotes work on whole lines
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split("\n");
  const has = PREFIX[kind];
  const off = lines.every((l) => has.test(l));
  const done = lines.map((l, i) => (off ? l.replace(has, "") : kind === "bullets" ? `- ${l.replace(/^\d+\. |^[-*] /, "")}` : kind === "numbers" ? `${i + 1}. ${l.replace(/^\d+\. |^[-*] /, "")}` : `> ${l}`)).join("\n");
  return { text: text.slice(0, from) + done + text.slice(to), start: from, end: from + done.length };
}
