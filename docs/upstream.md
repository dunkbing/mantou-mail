# What Mantou Mail needs from Mantou

Problems and gaps found while building the app, with the issue for each in [dunkbing/mantou](https://github.com/dunkbing/mantou/issues) and the workaround in use. Code comments next to each workaround name the issue, so it's easy to find and remove once Mantou ships a fix. A need that can't be filed yet gets drafted here, ready to paste into Mantou's issue template, until someone files it.

The app uses `mantou-ui` 0.1.4 from npm. Found on Linux (Ubuntu 24.04) with Mesa lavapipe, headless and in a window under Xvfb.

## Open

| Need | Kind | Issue | Workaround in the app |
|---|---|---|---|
| Telling a cancelled dialog from one that couldn't be shown (and Linux's zenity cancel answers `[]`) | bug | [dunkbing/mantou#28](https://github.com/dunkbing/mantou/issues/28) | a guess at whether the system has dialogs (zenity, or a portal and D-Bus); without them, a path field to attach, Save as goes to Downloads, removing an account doesn't ask (`hasDialogs` in `src/mail/files.ts`) |
| Setting an `<Input>`'s value leaves the caret where it was; no way to place it | bug | [dunkbing/mantou#30](https://github.com/dunkbing/mantou/issues/30) | taking an address suggestion recreates the To/Cc/Bcc input, whose caret starts at the end (`AddressField` in `src/ui/Compose.tsx`) |
| The app sets its window's size and minimum size | feature | [dunkbing/mantou#29](https://github.com/dunkbing/mantou/issues/29) | `bun run dev` passes `--width 1200 --height 760`; the built executable opens at 640 × 400 unless started with them |
| A right click (to open a context menu), context menus on Linux and Windows, opening a file or a URL with the system's app | feature | Mantou's [#21](https://github.com/dunkbing/mantou/issues/21) ([the app's needs](https://github.com/dunkbing/mantou/issues/21#issuecomment-6625154743)) | no context menus; opening attachments, and Google's sign-in page, with `open`/`xdg-open`/`start` (`src/mail/files.ts`, `src/mail/oauth.ts`) |
| Rich text (to show HTML mail, and a formatting composer) | feature | Mantou's [#15](https://github.com/dunkbing/mantou/issues/15) | mail shown as text; the composer takes Markdown and sends it as HTML too (`src/mail/format.ts`) |
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
| Icons: app fonts (and vector images) | [#8](https://github.com/dunkbing/mantou/issues/8) ([#14](https://github.com/dunkbing/mantou/issues/14)) | 0.1.4 | Lucide's icon font with `registerFont` and `fontFamily` (`src/ui/icons.tsx`); images are still [#13](https://github.com/dunkbing/mantou/issues/13) |
| File dialogs, message boxes, the app menu | [#21](https://github.com/dunkbing/mantou/issues/21) (in part) | 0.1.4 | `openFile` to attach, `saveFile` to save an attachment, `message` before removing an account, `setMenu`/`onMenu` (`src/mail/files.ts`, `src/ui/menu.ts`) |
| Shadows | [#12](https://github.com/dunkbing/mantou/issues/12) | 0.1.4 | `boxShadow` under the dialogs and the Compose button |

Text input wasn't filed: Mantou shipped `<Input>` in [`92ed187`](https://github.com/dunkbing/mantou/commit/92ed18731d53b7d077da42119eee786c607f2936) (in 0.1.1).
