// Workaround for dunkbing/mantou#87: <Html> panics the core on a stylesheet <link>, an @import, or an <img> whose
// address is relative or protocol-relative (`//fonts.googleapis.com/...`, `logo.png`), because the document's base
// is a data: URL. Mail does all of these. Take them out before the document is drawn: none of them could load anyway.
const LINK = /<link\b[^>]*>/gi;
const IMPORT = /@import\b[^;{}]*;?/gi;
const IMG = /<img\b[^>]*>/gi;
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
// Addresses the document can resolve by themselves.
const ABSOLUTE = /^\s*(?:https?:|data:|cid:)/i;

export function safeHtml(html: string): string {
  return html.replace(LINK, "").replace(IMPORT, "").replace(IMG, (tag) => {
    const m = SRC.exec(tag);
    const src = m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
    return ABSOLUTE.test(src) ? tag : "";
  });
}
