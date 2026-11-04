# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.2.0 from npm. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb, and on macOS 27 (Apple M4).

## Open

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| Telling a cancelled dialog from one that couldn't be shown (and Linux's zenity cancel answers `[]`) | bug | [dunkbing/mantou#28](https://github.com/dunkbing/mantou/issues/28) | a guess at whether the system has dialogs (zenity, or a portal and D-Bus); without them, a path field to attach, Save as goes to Downloads, removing an account doesn't ask (`hasDialogs` in `src/mail/files.ts`) |
| `defineStyle` shared styles don't follow the colour scheme, and a `defineTheme` made before the window opens doesn't follow the system | bug | Mantou's [#53](https://github.com/dunkbing/mantou/issues/53), [#54](https://github.com/dunkbing/mantou/issues/54) | shared styles are plain functions called in the JSX (`src/ui/theme.ts`), and `App` calls `useColorScheme()` once |
| After a context menu is dismissed (macOS), pointer down events go to the row that was right-clicked | bug | [dunkbing/mantou#55](https://github.com/dunkbing/mantou/issues/55) | the Shift/Ctrl key held at a press is kept in one variable for all rows (`src/ui/MessageList.tsx`) |
| Context menus on Linux and Windows (a right click, `onContextMenu`, is in 0.1.7; `showMenu` works on macOS) | feature | Mantou's [#21](https://github.com/dunkbing/mantou/issues/21) ([the app's needs](https://github.com/dunkbing/mantou/issues/21#issuecomment-6625154743)) | none: the row menu only opens on macOS |
| `setMenu` while the app is being set up answers `false` and installs nothing (macOS) | bug | [dunkbing/mantou#48](https://github.com/dunkbing/mantou/issues/48) | the menu is set at the first layout (`installMenu` in `src/App.tsx`) |
| The Edit menu's predefined items (undo, cut, copy, paste, select all) take Cmd+Z/X/C/V/A before an `<Input>` sees them (macOS) | bug | [dunkbing/mantou#49](https://github.com/dunkbing/mantou/issues/49) | the Edit menu has only Find; the inputs handle those keys (`src/ui/menu.ts`) |
| `showMenu` opens the menu at `height - y` (y counted from the bottom of the window) on macOS | bug | [dunkbing/mantou#51](https://github.com/dunkbing/mantou/issues/51) | the row menu passes `windowHeight - y` on macOS (`menu` in `MessageList`) |
| A hidden title bar that keeps macOS's traffic lights, with the app's content under them (`frameless` and `<View dragRegion>` are in 0.2.0, but a frameless window has no buttons, and no `win.close()`) | feature | [dunkbing/mantou#52](https://github.com/dunkbing/mantou/issues/52) (and #37's [comments](https://github.com/dunkbing/mantou/issues/37#issuecomment-6637649710)) | the native title bar |
| Rich text (to show HTML mail, and a formatting composer) | feature | Mantou's [#15](https://github.com/dunkbing/mantou/issues/15) | mail shown as text; the composer takes Markdown and sends it as HTML too (`src/mail/format.ts`) |
| `<List>` with rows of different heights (in 0.1.7, [#31](https://github.com/dunkbing/mantou/issues/31)) throws when its items get fewer | bug | [dunkbing/mantou#50](https://github.com/dunkbing/mantou/issues/50) | rows rendered a page at a time, more as the scroll nears the end (`MessageList`) |

## Fixed

| Need | Issue | In | What the app uses now |
|---|---|---|---|
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
