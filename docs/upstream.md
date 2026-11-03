# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.1.1 from npm. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

| Need | Kind | Issue | Status | Workaround in the app |
|---|---|---|---|---|
| Scroll views: core scrolling, scrollbars, scroll into view, a virtualised list | feature | [dunkbing/mantou#5](https://github.com/dunkbing/mantou/issues/5) | open | wheel and negative margins, a drawn thumb, a "keep the selection in view" effect (`src/ui/scroll.tsx`), rows rendered a page at a time (`MessageList`) |
| Focus scopes: Tab stays in a dialog | feature | [dunkbing/mantou#6](https://github.com/dunkbing/mantou/issues/6) | open | the search field hands the focus back to the open dialog (`dialogFocus` in `src/ui/common.tsx`) |
| Password inputs (`secure`) | feature | [dunkbing/mantou#7](https://github.com/dunkbing/mantou/issues/7) | open | the input's text is drawn in no colour over a row of bullets (`PasswordField` in `src/ui/Accounts.tsx`) |
| Icons: vector images (SVG) or app-supplied fonts | feature | [dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8) | open | icons drawn from views on a 16-unit grid, and Inter's glyphs (`src/ui/icons.tsx`) |
| Every commit re-lays out every Text node; past 4,096 the text cache thrashes | bug (performance) | [dunkbing/mantou#9](https://github.com/dunkbing/mantou/issues/9) | open | rows rendered a page at a time keep the tree small (see [performance.md](performance.md)) |
| `right`/`bottom` on absolute views resolve against the window | bug | [dunkbing/mantou#1](https://github.com/dunkbing/mantou/issues/1) | fixed in 0.1.2 | `position: "relative"` on scroll viewports (`RELATIVE`) |
| Errors in `.tsx` files report the wrong line | bug | [dunkbing/mantou#2](https://github.com/dunkbing/mantou/issues/2) | fixed in 0.1.2 | none |
| Resize events for apps | feature | [dunkbing/mantou#3](https://github.com/dunkbing/mantou/issues/3) | `onLayout` and `useWindowSize()` in 0.1.2 | scroll areas measure again on each wheel turn or change (`createScroll`) |
| `autoFocus` focuses an input whenever the prop turns true | bug | [dunkbing/mantou#4](https://github.com/dunkbing/mantou/issues/4) | fixed in 0.1.2 | the composer decides once which field starts with the focus (`Composer`, `startInBody`) |

When 0.1.2 is on npm for Linux too (its Linux core packages were still in review when this was written), `bun add mantou-ui@0.1.2` and drop the workarounds for #1–#4: `RELATIVE`, `startInBody`, and `createScroll`'s measuring on every wheel turn (measure in `onLayout` instead).

Text input wasn't filed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) (in 0.1.1), and the search field, the composers and the Accounts dialog use it.
