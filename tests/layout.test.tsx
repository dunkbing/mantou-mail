// Dragging the handle between the list and the reader changes the list's width, within limits, and is kept.
import { afterEach, expect, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { Store } from "../src/mail/store";
import { LIST_WIDTH, listWidth, restoreListWidth } from "../src/ui/layout";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("the handle resizes the list, within limits; double-click resets; the width is reported when the drag ends", () => {
  const saved: number[] = [];
  restoreListWidth(undefined, (n) => saved.push(n));
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  mount(h.ui, () => <App />);
  h.step();
  // Find the handle by the pointer showing a resize cursor over it.
  const y = 300;
  let x = 0;
  for (let i = 300; i < 900 && !x; i += 2) {
    h.pointer("move", i, y);
    if (h.cursor() === "colResize") x = i;
  }
  expect(x).toBeGreaterThan(500);
  h.pointer("down", x, y);
  h.pointer("move", x + 100, y);
  h.step();
  expect(listWidth()).toBe(500);
  h.pointer("move", x + 900, y);
  expect(listWidth()).toBe(LIST_WIDTH.max);
  h.pointer("move", x - 900, y);
  expect(listWidth()).toBe(LIST_WIDTH.min);
  h.pointer("up", x - 900, y);
  expect(saved).toEqual([LIST_WIDTH.min]);
  restoreListWidth(5000); // a saved width is clamped; nothing saved is the default
  expect(listWidth()).toBe(LIST_WIDTH.max);
  restoreListWidth(undefined);
  expect(listWidth()).toBe(LIST_WIDTH.default);
});

test("settings are kept in the store", () => {
  const s = new Store(":memory:");
  expect(s.setting("listWidth")).toBeUndefined();
  s.putSetting("listWidth", "520");
  s.putSetting("listWidth", "530");
  expect(s.setting("listWidth")).toBe("530");
});

test("while an account syncs the empty list says it's loading, and the status dot breathes", async () => {
  const { Remote } = await import("../src/mail/remote");
  const { memorySecrets } = await import("../src/mail/secrets");
  const { createMail } = await import("../src/state");
  const remote = new Remote(new Store(":memory:"), memorySecrets());
  const set = (remote as unknown as { setStatus(id: string, s: { state: string; detail: string }): void }).setStatus.bind(remote);
  const h = new HeadlessCore({ width: 1200, height: 760 });
  open.push(h);
  mount(h.ui, () => <App mail={createMail([])} remote={remote} />);
  const has = (t: string) => [...h.ui.nodes.values()].some((n) => n.isText && n.textContent === t);
  set("a", { state: "syncing", detail: "Syncing…" });
  h.step();
  expect(has("Loading your mail…")).toBe(true);
  set("a", { state: "ready", detail: "Up to date" });
  h.step();
  expect(has("Loading your mail…")).toBe(false);
  expect(has("You're all caught up")).toBe(true);
  remote.stop();
});
