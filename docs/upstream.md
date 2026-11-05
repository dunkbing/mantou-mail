# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.3.1 from npm. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb, and on macOS 27 (Apple M4).

## Open

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| Telling a cancelled dialog from one that couldn't be shown (and Linux's zenity cancel answers `[]`) | bug | [dunkbing/mantou#28](https://github.com/dunkbing/mantou/issues/28) | a guess at whether the system has dialogs (zenity, or a portal and D-Bus); without them, a path field to attach, Save as goes to Downloads, removing an account doesn't ask (`hasDialogs` in `src/mail/files.ts`) |
| A `<View dragRegion>` with no children and no background doesn't move the window (it isn't hit) | bug | [dunkbing/mantou#56](https://github.com/dunkbing/mantou/issues/56) | the strip under the traffic lights has a background |
| Showing HTML mail: a web view that is safe for mail (no scripts, remote content blocked, links intercepted, sized to its content, scrolls with the reader), or a native HTML renderer | feature | Mantou's [#73](https://github.com/dunkbing/mantou/issues/73) ([what mail needs](https://github.com/dunkbing/mantou/issues/73#issuecomment-6664728814)), [#74](https://github.com/dunkbing/mantou/issues/74) | the plain-text part only |
| Context menus on Linux and Windows (a right click, `onContextMenu`, is in 0.1.7; `showMenu` works on macOS) | feature | Mantou's [#21](https://github.com/dunkbing/mantou/issues/21) ([the app's needs](https://github.com/dunkbing/mantou/issues/21#issuecomment-6625154743)) | none: the row menu only opens on macOS |

## Fixed

| Need | Issue | In | What the app uses now |
|---|---|---|---|
| `setMenu` at startup answered `false` (macOS) | [#48](https://github.com/dunkbing/mantou/issues/48) | 0.3.1 | `setMenu(APP_MENU)` when the app is set up |
| The Edit menu's predefined items took Cmd+A/C/X/V/Z from inputs (macOS) | [#49](https://github.com/dunkbing/mantou/issues/49) | 0.3.1 | the Edit menu has undo, redo, cut, copy, paste and select all; checked in a window |
| `showMenu` counted y from the bottom of the window (macOS) | [#51](https://github.com/dunkbing/mantou/issues/51) | 0.3.1 | the row menu passes the pointer's y as it is |
| A `defineTheme` made before the window opens followed nothing; `defineStyle` styles didn't follow the scheme | [#54](https://github.com/dunkbing/mantou/issues/54), [#53](https://github.com/dunkbing/mantou/issues/53) | 0.3.1 | the theme follows the system without a call from the app (shared styles stay plain functions: nothing to gain from changing them back) |
| After a context menu, pointer downs went to the right-clicked row | [#55](https://github.com/dunkbing/mantou/issues/55) | 0.3.1 | — (the app still ignores a click right after a menu closes, and keeps the held key in one variable) |
| Rich text: spans inside `<Text>` | [#15](https://github.com/dunkbing/mantou/issues/15) | 0.3.1 | links in messages are underlined spans that open in the browser (`linkParts`, `src/ui/common.tsx`); HTML mail as rich text and a formatting composer are still to do |
| `<List>` with rows of different heights threw when its items got fewer | [#50](https://github.com/dunkbing/mantou/issues/50) | 0.3.1 | not used yet: the list still pages (`src/ui/MessageList.tsx`); moving it to `<List>` is next |
| A hidden title bar that keeps macOS's traffic lights, and `win.close()` | [#52](https://github.com/dunkbing/mantou/issues/52), [#37](https://github.com/dunkbing/mantou/issues/37) | 0.2.1 | `titleBar: "overlay"` and `win.safeArea` (the app uses them on macOS) |
| Opening a file or a URL with the system's app | [#21](https://github.com/dunkbing/mantou/issues/21) (in part), [#38](https://github.com/dunkbing/mantou/issues/38) | 0.2.0 | `openExternal` (`openWithSystem` in `src/mail/files.ts`) |
| Setting an `<Input>`'s value left the caret where it was | [#30](https://github.com/dunkbing/mantou/issues/30) | 0.1.7 | `setSelection` after a suggestion is taken (`AddressField` in `src/ui/Compose.tsx`) |
| `right`/`bottom` on absolute views resolve against the window | [#1](https://github.com/dunkbing/mantou/issues/1) | 0.1.2 | plain `position: "absolute"` |
| Errors in `.tsx` files report the wrong line | [#2](https://github.com/dunkbing/mantou/issues/2) | 0.1.2 | — |
| Resize events for apps | [#3](https://github.com/dunkbing/mantou/issues/3) | 0.1.2 | `onLayout` (the message list's page loading) |
| `autoFocus` focuses an input whenever the prop turns true | [#4](https://github.com/dunkbing/mantou/issues/4) | 0.1.2 | `autoFocus` straight from the draft |
| Scroll views | [#5](https://github.com/dunkbing/mantou/issues/5) | 0.1.3 | `<Scroll>`, `scrollIntoView`, `scrollTo`, `onScroll` in the list and the reader |
| Focus scopes for dialogs | [#6](https://github.com/dunkbing/mantou/issues/6) | 0.1.3 | `<View focusScope>` on the composer and the Accounts dialog |
| Password inputs | [#7](https://github.com/dunkbing/mantou/issues/7) | 0.1.3 | `<Input secure>` |
| Every commit re-lays out every Text node | [#9](https://github.com/dunkbing/mantou/issues/9) | 0.1.3 | — (see [performance.md](performance.md)) |
| Icons: app fonts (and vector images) | [#8](https://github.com/dunkbing/mantou/issues/8) ([#14](https://github.com/dunkbing/mantou/issues/14)) | 0.1.4 | Lucide's icon font with `registerFont` and `fontFamily` (`src/ui/icons.tsx`); `<Image>` came in 0.1.5 ([#13](https://github.com/dunkbing/mantou/issues/13)) |
| File dialogs, message boxes, the app menu | [#21](https://github.com/dunkbing/mantou/issues/21) (in part) | 0.1.4 | `openFile` to attach, `saveFile` to save an attachment, `message` before removing an account, `setMenu`/`onMenu` (`src/mail/files.ts`, `src/ui/menu.ts`) |
| The app sets its window's size and limits | [#29](https://github.com/dunkbing/mantou/issues/29) | 0.1.5 | `run()` with `width`, `height`, `minWidth`, `minHeight` (`src/main.tsx`) |
| Shadows | [#12](https://github.com/dunkbing/mantou/issues/12) | 0.1.4 | `boxShadow` under the dialogs and the Compose button |

Text input wasn't filed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) (in 0.1.1).
