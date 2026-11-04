// Run by theme.test.ts, in a process of its own (SCHEME_CHECK=1): the colour scheme is global, and apps other tests leave mounted would redraw when it changes.
import { expect, test } from "bun:test";
import { mount, setColorScheme } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { createMail } from "../src/state";

test.skipIf(!process.env.SCHEME_CHECK)("dark turns the window and the lines dark, light brings them back", () => {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  mount(h.ui, () => <App mail={createMail()} />);
  h.step();
  const at = (x: number, y: number) => [...h.capture().at(x, y)].slice(0, 3);
  expect(at(700, 700)).toEqual([255, 255, 255]); // the reader's background
  setColorScheme("dark");
  h.step();
  const dark = at(700, 700);
  expect(Math.max(...dark)).toBeLessThan(60);
  setColorScheme("light");
  h.step();
  expect(at(700, 700)).toEqual([255, 255, 255]);
});
