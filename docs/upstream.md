# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.1.1 from npm; #1–#3 were found at commit `d253daa` and are still present in 0.1.1, #4 was found in 0.1.1. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| `right`/`bottom` on absolute views resolve against the window | bug | [dunkbing/mantou#1](https://github.com/dunkbing/mantou/issues/1) | `position: "relative"` on scroll viewports (`src/App.tsx`, `RELATIVE`) |
| Errors in `.tsx` files report the wrong line | bug | [dunkbing/mantou#2](https://github.com/dunkbing/mantou/issues/2) | none |
| Resize events for apps | feature | [dunkbing/mantou#3](https://github.com/dunkbing/mantou/issues/3) | scroll areas measure again on each wheel turn or change (`createScroll`) |
| `autoFocus` focuses an input whenever the prop turns true, not only when it's created | bug | [dunkbing/mantou#4](https://github.com/dunkbing/mantou/issues/4) | the composer decides once which field starts with the focus (`Composer`, `startInBody`) |

Text input wasn't filed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) (in 0.1.1), and the search field and the composers use it.
