# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.1.1 from npm; the three issues were found at commit `d253daa` and are still present in 0.1.1. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| `right`/`bottom` on absolute views resolve against the window | bug | [dunkbing/mantou#1](https://github.com/dunkbing/mantou/issues/1) | `position: "relative"` on scroll viewports (`src/App.tsx`, `RELATIVE`) |
| Errors in `.tsx` files report the wrong line | bug | [dunkbing/mantou#2](https://github.com/dunkbing/mantou/issues/2) | none |
| Resize events for apps | feature | [dunkbing/mantou#3](https://github.com/dunkbing/mantou/issues/3) | scroll areas measure again on each wheel turn or change (`createScroll`) |
| Text input | feature | not needed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) | none needed now: 0.1.1 has `<Input>`; search still types through `onKey` (`SearchField`) until it moves over |

## Text input

`mantou-ui` 0.1.1 has `<Input>` (single-line and multiline, caret, selection, clipboard, IME, `value`/`onChange`, `onSubmit`, focus events; keys the focused input uses don't reach `onKey`), plus `HeadlessCore.type` for tests. What's left is in the app:

- Replace `SearchField`'s `onKey` typing with an `<Input>`, and drop the `searching` key routing in `App`.
- Compose and real replies become possible (phase 2 of [agentic-design.md](agentic-design.md)).
