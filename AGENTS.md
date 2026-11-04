# AGENTS.md

Guide for coding agents (and people) working on Mantou Mail: a desktop mail client built on [Mantou](https://github.com/dunkbing/mantou), a native GUI framework for Bun + TypeScript. This repo is also how Mantou finds out what real apps need: **when the framework is missing something or gets something wrong, report it upstream** (see below) instead of hacking around it silently.

## Layout

| Path | What |
|---|---|
| `src/data.ts` | The data types (`Message`, `Account`), the clock (`now()`: fixed in tests, real in the app), and sample mail for when no account is set up |
| `src/state.ts` | Solid signals and actions (select, move, archive, move to inbox, delete, snooze, labels, star, unread, search, drafts and their attachments, compose, reply and reply all, forward, send and Send Later, undo); parsing and suggesting addresses (To, Cc, Bcc). Knows nothing of views or servers: `onChange(prev, next)` reports the user's changes, `receive()` takes the servers' messages |
| `src/App.tsx` | The app: layout and keyboard handling |
| `src/ui/` | The UI, a file per part: `Sidebar`, `Toolbar`, `MessageList`, `Reader` (conversation, reply/snooze/label panel), `Compose` (reply and new-message composers, address lines with suggestions), `Accounts` (the Accounts dialog), `StatusBar`, `Shortcuts`; `common` (avatars, chips, buttons), `icons` (Lucide's icon font: use `<Icon name>`; a new icon needs its glyph in the font, `scripts/subset-icons.py`), `menu` (the app menu), `theme` (colours, shared styles) |
| `src/mail/` | Real accounts: `remote` (accounts, passwords, the outbox, the bridge to the state), `imap` (one account's sync over IMAP, with imapflow), `smtp` (sending: the message as RFC 822, with nodemailer), `format` (what a message says as sent: the quoted original, and HTML from the Markdown people type), `store` (the local copy, SQLite: messages, changes not yet on the server, how much of each folder is kept), `parse` (raw mail to `Message`; attachments from the MIME structure), `blobs` (attachments' bytes on disk, by hash), `files` (Downloads, opening with the system's app, Mantou's file dialogs and message box, and whether the system can show them), `providers` (settings guessed from an address, and how to get each provider's app password), `oauth` (signing in with Google or Microsoft: the browser, a loopback port, PKCE, refresh tokens, company domains by MX; docs/oauth.md), `secrets` (the OS keychain: passwords and refresh tokens), `paths` (the data folder) |
| `src/main.tsx` | Entry: the store, the accounts, then `run(() => <App />)` |
| `tests/` | Bun tests on a headless instance of Mantou's real core; real accounts against IMAP and SMTP servers in the test process (`tests/server.ts`: hoodiecrow, smtp-server, and a stand-in for Google's and Microsoft's OAuth endpoints) |
| `scripts/` | `demo-server`: IMAP and SMTP servers with the sample mail, to try real accounts locally; `subset-icons.py`: remakes the icon font |
| `assets/` | Files the app reads at run time, imported `with { type: "file" }` so `bun run build` embeds them: the icon font |
| `bench/` | `bun run perf`: what the common interactions cost (time, ops, layouts, nodes), sample and 2,000-message mailboxes; results in `docs/performance.md` |
| `docs/upstream.md` | What the app needs from Mantou: the issues filed (and drafts of any not yet filed), with the workaround in use |

## Commands

```bash
bun install          # mantou-ui from npm, pinned in package.json / bun.lock, with a prebuilt native core
bun run dev          # the app in a window (on headless Linux: xvfb-run -a bun run dev)
bun run build        # one executable in dist/, Mantou's core beside it
bun run demo-server  # IMAP on 127.0.0.1:1143 and SMTP on :1025 with the sample mail (testuser / testpass)
bun test             # headless tests (captures need a GPU adapter; Mesa's lavapipe is fine)
bun run typecheck    # bun check
bun run perf         # interaction costs on the real core (not part of bun test)
```

## How the app uses Mantou

- `mantou-ui` is an npm package pinned to an exact version (`0.1.7`). Its native core comes prebuilt in a per-platform optional dependency (`mantou-ui-linux-x64` and so on); only on a platform without one would `bunx mantou build-core` (needs Rust) build it from source. Don't edit `node_modules/mantou-ui`; anything that needs changing there is an upstream issue.
- Import everything from `mantou-ui` (components, `createSignal` and the rest of Solid's API, `defineStyle`), `mantou-ui/headless` (tests) and `mantou-ui/mock`. **Never import `solid-js` directly**: Bun resolves it to Solid's server build, which has no reactivity.
- JSX is compiled by Mantou's plugin: `tsconfig.json` has `"jsx": "preserve"` and `"jsxImportSource": "mantou-ui"`; `bunfig.toml` preloads `mantou-ui/preload` for tests; `mantou run` registers it for the app.
- Read Mantou's docs before building something: https://mantou.dunkbing.dev (LLM-friendly: `/llms.txt`, `/llms-full.txt`, any page as `.md`). Its `AGENTS.md` has the framework's rules.

What Mantou can do today: `<View>` and `<Text>`, flexbox layout, text with `maxLines` ellipsis, rounded corners and borders, `overflow: "hidden"` clipping, `onPress`, `onWheel`, `onKey`, `node.measure()`, `onLayout` and `useWindowSize()`, `position: "absolute"` (overlays), `<Scroll>` (scrolled by the core, with a thumb; `scrollIntoView`, `scrollTo`, `onScroll`; tests scroll with `h.wheel`), `<View focusScope>` (dialogs: Tab stays inside, the focus comes back), `<Input>` (single-line and multiline, edited in the core; keys it uses don't reach `onKey`, though Esc, and Up/Down from a single-line one, still do; Ctrl/⌘+Enter submits a multiline one; `secure` for passwords; tests type with `h.type`, check `h.focused()`, and send shortcuts with `h.key(k, { primary: true })`), shared styles (`defineStyle`), Solid's `For`/`Index`/`Show`/`Switch`, `boxShadow`, app fonts (`registerFont` and `fontFamily`: the icons are a font), platform services (`openFile`, `saveFile`, `message`, `setMenu`/`onMenu`, `showMenu`; tests answer them with `h.answer`, read them with `h.lastService()` and pick menu items with `h.chooseMenu`), `run()` window size and limits, `<List>` (virtualized, rows of one height), `<Image>`, animations, and `mantou build` (one executable). Not yet (in 0.1.5): a virtualized list with rows of different heights (the message list renders a page of rows at a time), rich text (#15), hover (#18), focus for anything but inputs (#17), a right click and context menus off macOS (#21), opening a file with its app (#21), telling a cancelled dialog from a missing one (#28), placing an input's caret (#30: setting `value` leaves the caret where it was), drag and drop, multiple windows (#23), accessibility (#24).

Networking and storage are Bun's, not Mantou's: IMAP with imapflow (it runs in the app's Worker), the local copy with `bun:sqlite`, passwords with `Bun.secrets`.

Layout is CSS flexbox, with its sharp edges: `flexShrink` defaults to 1 (fixed-size parts need `flexShrink: 0`), and flex items are at least as tall as their content unless they clip (a `<Scroll>` and its ancestors need `minHeight: 0`, and a region whose height should come from the window rather than from its content needs `flexBasis: 0`). A ref to a node inside `<Show>` goes stale when the `<Show>` releases it: check `node.released` before calling it from an effect.

## Reporting to Mantou

Open issues in **dunkbing/mantou** with its templates (https://github.com/dunkbing/mantou/issues/new/choose):

- **Bug report** — something that doesn't behave as documented. Include a minimal reproduction, ideally a failing headless test (`mantou-ui/headless`) so it can become a regression test, the `mantou-ui` commit (from `bun.lock`), OS and GPU, and window or headless.
- **Feature request** — something the app needs. Say which app feature it unblocks, sketch the TSX API you'd want, and describe the workaround you're using meanwhile.

With the GitHub CLI: `gh issue create --repo dunkbing/mantou --template bug_report.md` (or `feature_request.md`). One issue per problem; search first (`gh issue list --repo dunkbing/mantou --search "..."`) and add to an existing one rather than duplicating it. Link the issue from a comment next to any workaround in this repo (`// Workaround for dunkbing/mantou#12`) so it's easy to remove later. If you can't file it yourself, write it up in `docs/upstream.md` (ready to paste into the template) and point the comment there; whoever files it replaces the pointer with the issue number.

When Mantou ships a fix: `bun add mantou-ui@<version>` (exact version), run the tests, remove the workaround. The bug report's "mantou-ui commit" is the package version (and the commit, if you know it).

## Before you finish

Run `bun run typecheck && bun test`. Add a line to `CHANGELOG.md` (Unreleased) for each change a person using the app can see, in plain words, and one for each Mantou upgrade ("Updated Mantou to 0.1.x: …", with the main thing it enabled). If you changed what's on screen or how much of it there is, run `bun run perf` and compare with `docs/performance.md`; a cost that's Mantou's is an upstream issue (with the measurement), like dunkbing/mantou#9. Real-account tests wait for conditions (`until` in `tests/server.ts`), never for a time. If you changed what the app looks like, check it with a headless capture or in a window, and update `docs/screenshot.png` when the change is visible.
