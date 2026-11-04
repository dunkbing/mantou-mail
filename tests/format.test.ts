// What a message says as sent: the reply's quote and the HTML made from the
// little Markdown people write in plain text (src/mail/format.ts).
import { expect, test } from "bun:test";
import { hasFormatting, replyText, toHtml } from "../src/mail/format";
import type { Message } from "../src/data";

test("inline formatting, with the text escaped first", () => {
  expect(toHtml("**Bold**, *italic*, _also_ and `a < b`")).toBe("<p><strong>Bold</strong>, <em>italic</em>, <em>also</em> and <code>a &lt; b</code></p>");
  expect(toHtml("<script>alert(1)</script> & co")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</p>");
  expect(toHtml("See [the doc](https://x.dev/a?b=1&c=2) or https://x.dev/b.")).toBe('<p>See <a href="https://x.dev/a?b=1&amp;c=2">the doc</a> or <a href="https://x.dev/b">https://x.dev/b</a>.</p>');
  expect(toHtml("[click](javascript:alert(1))")).not.toContain("<a"); // only http(s) and mailto links
});

test("what isn't formatting stays text: snake_case, 2*3*4, a lone star", () => {
  expect(hasFormatting("set snake_case_names, 2*3*4 = 24, a * b")).toBe(false);
  expect(toHtml("snake_case_names and 2*3*4")).toBe("<p>snake_case_names and 2*3*4</p>");
});

test("blocks: paragraphs and line breaks, lists, quotes", () => {
  expect(toHtml("Hi,\nsee below.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n> more")).toBe(
    "<p>Hi,<br>see below.</p>\n<ul><li>one</li><li>two</li></ul>\n<ol><li>first</li><li>second</li></ol>\n<blockquote><p>quoted<br>more</p></blockquote>",
  );
  expect(hasFormatting("- one\n- two")).toBe(true);
});

test("a reply's text quotes the original under who wrote it and when", () => {
  const original = { from: { name: "Priya Shah", email: "priya@example.com" }, date: new Date(2026, 10, 2, 16, 5), body: ["Hi,", "Thursday?\nPriya"] } as Message;
  expect(replyText("Yes.", original)).toBe("Yes.\n\nOn Mon, 2 Nov 2026 at 16:05, Priya Shah <priya@example.com> wrote:\n> Hi,\n>\n> Thursday?\n> Priya");
  expect(replyText("Yes.")).toBe("Yes.");
});
