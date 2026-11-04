# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.1.3 from npm. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

## Open

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| Icons: vector images (SVG) or app-supplied fonts | feature | [dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8) (and Mantou's [#13](https://github.com/dunkbing/mantou/issues/13) images, [#14](https://github.com/dunkbing/mantou/issues/14) app fonts) | icons drawn from views on a 16-unit grid, and Inter's glyphs (`src/ui/icons.tsx`) |
| Native file dialogs (attach, save as), opening a file with its app | feature | Mantou's [#21](https://github.com/dunkbing/mantou/issues/21) ([the app's needs](https://github.com/dunkbing/mantou/issues/21#issuecomment-6621933514)) | the platform's own picker run from Bun (osascript, PowerShell, zenity, kdialog), else a path field; opening with `open`/`xdg-open`/`start` (`src/mail/files.ts`) |
| A virtualised list | feature | Mantou's [#19](https://github.com/dunkbing/mantou/issues/19) (asked for in [#5](https://github.com/dunkbing/mantou/issues/5)) | rows rendered a page at a time, more as the scroll nears the end (`MessageList`) |

## Fixed

| Need | Issue | In | What the app uses now |
|---|---|---|---|
| `right`/`bottom` on absolute views resolve against the window | [#1](https://github.com/dunkbing/mantou/issues/1) | 0.1.2 | plain `position: "absolute"` |
| Errors in `.tsx` files report the wrong line | [#2](https://github.com/dunkbing/mantou/issues/2) | 0.1.2 | — |
| Resize events for apps | [#3](https://github.com/dunkbing/mantou/issues/3) | 0.1.2 | `onLayout` (the message list's page loading) |
| `autoFocus` focuses an input whenever the prop turns true | [#4](https://github.com/dunkbing/mantou/issues/4) | 0.1.2 | `autoFocus` straight from the draft |
| Scroll views | [#5](https://github.com/dunkbing/mantou/issues/5) | 0.1.3 | `<Scroll>`, `scrollIntoView`, `scrollTo`, `onScroll` in the list and the reader |
| Focus scopes for dialogs | [#6](https://github.com/dunkbing/mantou/issues/6) | 0.1.3 | `<View focusScope>` on the composer and the Accounts dialog |
| Password inputs | [#7](https://github.com/dunkbing/mantou/issues/7) | 0.1.3 | `<Input secure>` |
| Every commit re-lays out every Text node | [#9](https://github.com/dunkbing/mantou/issues/9) | 0.1.3 | — (see [performance.md](performance.md)) |

Text input wasn't filed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) (in 0.1.1).
