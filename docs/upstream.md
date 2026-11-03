# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the workaround in use. Each one is an issue for [dunkbing/mantou](https://github.com/dunkbing/mantou/issues/new/choose); the text below is ready to paste into its template. Once an issue is filed, put its number in the table, change the code comments that point here to `dunkbing/mantou#N`, and drop the draft from this page.

Found with `mantou-ui` at `d253daa060eb914e2441bb71c70f153baa1d44db`, on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| [Absolute insets](#absolute-insets) | bug | not filed yet | `position: "relative"` on scroll viewports (`src/App.tsx`, `RELATIVE`) |
| [Line numbers in .tsx](#line-numbers-in-tsx) | bug | not filed yet | none |
| [Resize events](#resize-events) | feature | not filed yet | scroll areas measure again on each wheel turn or change (`createScroll`) |
| [Text input](#text-input) | feature | not filed yet | search is typed through `onKey` and drawn as text with a caret (`SearchField`) |

---

## Absolute insets

**Template:** Bug report. **Title:** `right` and `bottom` on absolutely positioned views resolve against the window, not the parent

### What happened

A view with `position: "absolute"` and `right`/`bottom` is placed against the window's size, offset by its parent's position, so it ends up outside its parent (often off-screen). `left` and `top` come out right, but only because the core adds the parent's position to a location Taffy computed against the root.

In Mantou Mail, a scrollbar thumb (`position: "absolute", right: 3`) inside the 400 px message list was drawn at x = 1421 in a 1200 px window.

### What you expected

As the docs and `schema/protocol.ts` say, `position` defaults to `"relative"`, so every view is a containing block and the thumb sits 3 px from its parent's right edge.

### Cause

Taffy 0.15's `Style::default()` has `position: Position::Static`, and static boxes aren't containing blocks. `Tree::restyle` (and `CREATE`'s `new_leaf(Style::default())`) start from that default, and only the root is forced to `Relative`. Starting from `Style { position: Position::Relative, flex_direction: FlexDirection::Column, ..Style::default() }` in both places would match the schema. Taffy alone shows the same numbers (a 200×100 parent at x = 100 in a 640×400 root puts a `right: 0, bottom: 0` 10×10 child at 630, 390).

### Minimal reproduction

```tsx
import { afterEach, expect, test } from "bun:test";
import { mount, View, type Node } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";

const open: HeadlessCore[] = [];
afterEach(() => open.splice(0).forEach((h) => h.free()));

test("right/bottom resolve against the parent", () => {
  const h = new HeadlessCore({ width: 640, height: 400 });
  open.push(h);
  let child!: Node;
  mount(h.ui, () => (
    <View style={{ flexGrow: 1, flexDirection: "row" }}>
      <View style={{ width: 100 }} />
      <View style={{ width: 200, height: 100 }}>
        <View ref={child} style={{ position: "absolute", right: 0, bottom: 0, width: 10, height: 10 }} />
      </View>
    </View>
  ));
  h.step();
  expect(h.rect(child)).toEqual([290, 90, 300, 100]); // today: [730, 390, 740, 400]
});
```

Adding `position: "relative"` to the parent makes it pass.

### Where

- mantou-ui commit: `d253daa060eb914e2441bb71c70f153baa1d44db`
- App: dunkbing/mantou-mail, `src/App.tsx` (`ScrollThumb`)
- OS and GPU: Linux (Ubuntu 24.04), Mesa lavapipe
- Window or headless: both (the repro is headless)

---

## Line numbers in .tsx

**Template:** Bug report. **Title:** Errors in .tsx files report the wrong line

### What happened

Stack traces and `bun test` failures in `.tsx` files (anything compiled by Mantou's JSX plugin) point several lines below the real one. In the file below, the throw on line 13 is reported at `lines.test.tsx:18:38`, and the failing `expect` on line 17 at `lines.test.tsx:21:13`. The same code in a `.ts` file reports the right lines. The plugin asks Babel for `sourceMaps: "inline"`, but Bun doesn't seem to apply an inline map returned from `onLoad`.

### What you expected

The line that threw.

### Minimal reproduction

```tsx
import { expect, test } from "bun:test";
import { View, Text } from "mantou-ui";

const A = () => (
  <View style={{ flexGrow: 1 }}>
    <Text>a</Text>
    <Text>b</Text>
  </View>
);

test("the failing line is reported", () => {
  void A;
  throw new Error("thrown on line 13"); // reported as lines.test.tsx:18:38
});

test("an expect on line 17 fails", () => {
  expect(1).toBe(2); // reported as lines.test.tsx:21:13
});
```

Adding `retainLines: true` to the `transformAsync` options in `runtime/solid/plugin.ts` makes both report the right line (13 and 17; columns are still the compiled ones). That would be an easy fix until source maps work.

### Where

- mantou-ui commit: `d253daa060eb914e2441bb71c70f153baa1d44db`
- App: dunkbing/mantou-mail, `tests/mail.test.tsx`
- OS and GPU: Linux (Ubuntu 24.04), Bun 1.4.4
- Window or headless: headless (`bun test`), and any error in a window app

---

## Resize events

**Template:** Feature request. **Title:** Let apps know when the window (or a view) changes size

### What the app needs

A way to hear that the window resized, or better, that a view's laid-out size changed. Today `run()` takes `core.onEvent` for itself and `route()` passes only press, wheel and key events to the `Ui`, so `RESIZED` never reaches the app.

### What it unblocks

In dunkbing/mantou-mail: correct scroll limits and scrollbars in the message list and reader after a resize (both scroll by negative margins and clamp to `content - viewport`, which they measure with `node.measure()`); later, collapsing the sidebar or the reader in narrow windows.

### How it could look

```tsx
// Per view, after layout, when its box changes:
<View onLayout={(r: Rect) => setViewport(r.height)} />

// Or for the window:
const size = useWindowSize(); // () => { width, height, scale }
createEffect(() => setNarrow(size().width < 900));
```

### What the app does today

Scroll areas measure again on every wheel turn and after every change the app knows about (`createScroll` in `src/App.tsx`). After a window resize, the scrollbar and the scroll limit are stale until the next wheel turn, and the list can stay scrolled past its end. Core-driven scrolling (design §9.4) would remove the need for this in scroll areas, but layout that depends on size would still need it.

---

## Text input

**Template:** Feature request. **Title:** A text input: single-line first (caret, selection, IME, clipboard)

### What the app needs

A focusable single-line text input with a caret, selection, cursor movement (arrows, Home/End, word jumps), the clipboard and IME; then a multi-line one. The design docs list `Input`/`TextArea` among the v1 primitives.

### What it unblocks

In dunkbing/mantou-mail: search (today a stand-in, below), then compose, real replies (instead of three canned ones) and new labels.

### How it could look

```tsx
const [query, setQuery] = createSignal("");
<Input
  value={query()}
  onInput={(text) => setQuery(text)}
  onSubmit={() => openResults()}
  placeholder="Search mail"
  ref={(n) => (searchInput = n)}
  style={{ height: 32, fontSize: 13, borderRadius: 7 }}
/>;
searchInput.focus(); // when "/" is pressed
```

The app also needs to know whether an input has focus, so its single-key shortcuts (`e`, `j`, `#`…) don't fire while typing.

### What the app does today

`/` turns on a "searching" mode in which `onKey` appends characters to the query and Backspace removes the last one; the query is drawn as `<Text>` with a 1.5 px view as the caret. There's no selection, no cursor movement, no paste and no IME.
