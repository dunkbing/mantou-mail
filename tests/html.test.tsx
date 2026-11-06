// HTML that used to crash the core (dunkbing/mantou#87) is cleaned before it's drawn.
import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { sampleMessages } from "../src/data";
import { safeHtml } from "../src/mail/html";
import { createMail } from "../src/state";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

const CRASHERS = [
  '<link href="//fonts.googleapis.com/css?family=Google+Sans" rel="stylesheet"><p>Hello</p>',
  "<style>@import url(//fonts.googleapis.com/css?family=Google+Sans);</style><p>Hello</p>",
  '<p>Hello</p><img src="//cdn.example.com/logo.png">',
  '<p>Hello</p><img alt="x" src=logo.png>',
];

test("what the core can't resolve is taken out; what it can stays", () => {
  expect(safeHtml(CRASHERS[0])).toBe("<p>Hello</p>");
  expect(safeHtml(CRASHERS[1])).not.toContain("@import");
  expect(safeHtml(CRASHERS[2])).toBe("<p>Hello</p>");
  expect(safeHtml(CRASHERS[3])).toBe("<p>Hello</p>");
  for (const keep of ['<img src="https://a.com/x.png">', "<img src='data:image/png;base64,AAAA'>", '<img src="cid:logo@x">'])
    expect(safeHtml(keep)).toBe(keep);
});

test("a message with such HTML opens without crashing the app", () => {
  for (const body of CRASHERS) {
    const h = new HeadlessCore({ width: 1200, height: 760 });
    open.push(h);
    const m = { ...sampleMessages().find((x) => x.folder === "inbox")!, html: `<html><body>${body}</body></html>` };
    mount(h.ui, () => <App mail={createMail([m])} />);
    h.step();
    h.press([...h.ui.nodes.values()].find((n) => n.isText && n.textContent === m.subject)!);
    h.step();
  }
});
