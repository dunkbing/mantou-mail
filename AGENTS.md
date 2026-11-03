# AGENTS.md

Guide for coding agents (and people) working on Mantou Mail: a desktop mail client built on [Mantou](https://github.com/dunkbing/mantou), a native GUI framework for Bun + TypeScript. This repo is also how Mantou finds out what real apps need: **when the framework is missing something or gets something wrong, report it upstream** (see below) instead of hacking around it silently.

## Layout

| Path | What |
|---|---|
| `src/data.ts` | Sample mail (accounts, labels, messages and the conversations they belong to), relative to a fixed "now" so tests are deterministic |
| `src/state.ts` | Solid signals and actions (select, move, archive, move to inbox, delete, snooze, labels, star, unread, search, drafts, compose and send, undo); parsing To lines |
| `src/App.tsx` | The UI: sidebar (Compose, the search `<Input>`, mailboxes), toolbar and tabs, message list, reader (the whole conversation) and its panels (reply composer, snooze, labels), the new-message composer, status bar, shortcuts overlay; keyboard handling |
| `src/main.tsx` | Entry: `run(() => <App />)` |
| `tests/` | Bun tests on a headless instance of Mantou's real core |
| `docs/upstream.md` | What the app needs from Mantou: the issues filed (and drafts of any not yet filed), with the workaround in use |

## Commands

```bash
bun install          # mantou-ui from npm, pinned in package.json / bun.lock, with a prebuilt native core
bun run dev          # the app in a window (on headless Linux: xvfb-run -a bun run dev)
bun test             # headless tests (captures need a GPU adapter; Mesa's lavapipe is fine)
bun run typecheck    # bun check
```

## How the app uses Mantou

- `mantou-ui` is an npm package pinned to an exact version (`0.1.1`). Its native core comes prebuilt in a per-platform optional dependency (`mantou-ui-linux-x64` and so on); only on a platform without one would `bunx mantou build-core` (needs Rust) build it from source. Don't edit `node_modules/mantou-ui`; anything that needs changing there is an upstream issue.
- Import everything from `mantou-ui` (components, `createSignal` and the rest of Solid's API, `defineStyle`), `mantou-ui/headless` (tests) and `mantou-ui/mock`. **Never import `solid-js` directly**: Bun resolves it to Solid's server build, which has no reactivity.
- JSX is compiled by Mantou's plugin: `tsconfig.json` has `"jsx": "preserve"` and `"jsxImportSource": "mantou-ui"`; `bunfig.toml` preloads `mantou-ui/preload` for tests; `mantou run` registers it for the app.
- Read Mantou's docs before building something: https://mantou.dunkbing.dev (LLM-friendly: `/llms.txt`, `/llms-full.txt`, any page as `.md`). Its `AGENTS.md` has the framework's rules.

What Mantou can do today: `<View>` and `<Text>`, flexbox layout, text with `maxLines` ellipsis, rounded corners and borders, `overflow: "hidden"` clipping, `onPress`, `onWheel`, `onKey`, `node.measure()`, `position: "absolute"` (overlays, scrollbar thumbs), `<Input>` (single-line and multiline, edited in the core; keys it uses don't reach `onKey`, though Esc, and Up/Down from a single-line one, still do; Ctrl/⌘+Enter submits a multiline one; tests type with `h.type`, check `h.focused()`, and send shortcuts with `h.key(k, { primary: true })`), shared styles (`defineStyle`), Solid's `For`/`Index`/`Show`/`Switch`. Not yet: resize events (dunkbing/mantou#3), images, shadows, core-driven scrolling (the app scrolls with the wheel and negative margins), hover, focus for anything but inputs, drag and drop, menus, multiple windows, accessibility, real mail accounts (would need networking and storage on top of Bun).

Layout is CSS flexbox, with its sharp edges: `flexShrink` defaults to 1 (fixed-size parts need `flexShrink: 0`), and flex items are at least as tall as their content unless they clip (scroll containers' ancestors need `minHeight: 0`, and a region whose height should come from the window rather than from its scrolled content needs `flexBasis: 0`). An absolutely positioned view that uses `right` or `bottom` needs a parent with an explicit `position: "relative"` for now (dunkbing/mantou#1).

## Reporting to Mantou

Open issues in **dunkbing/mantou** with its templates (https://github.com/dunkbing/mantou/issues/new/choose):

- **Bug report** — something that doesn't behave as documented. Include a minimal reproduction, ideally a failing headless test (`mantou-ui/headless`) so it can become a regression test, the `mantou-ui` commit (from `bun.lock`), OS and GPU, and window or headless.
- **Feature request** — something the app needs. Say which app feature it unblocks, sketch the TSX API you'd want, and describe the workaround you're using meanwhile.

With the GitHub CLI: `gh issue create --repo dunkbing/mantou --template bug_report.md` (or `feature_request.md`). One issue per problem; search first (`gh issue list --repo dunkbing/mantou --search "..."`) and add to an existing one rather than duplicating it. Link the issue from a comment next to any workaround in this repo (`// Workaround for dunkbing/mantou#12`) so it's easy to remove later. If you can't file it yourself, write it up in `docs/upstream.md` (ready to paste into the template) and point the comment there; whoever files it replaces the pointer with the issue number.

When Mantou ships a fix: `bun add mantou-ui@<version>` (exact version), run the tests, remove the workaround. The bug report's "mantou-ui commit" is the package version (and the commit, if you know it).

## Before you finish

Run `bun run typecheck && bun test`. If you changed what the app looks like, check it with a headless capture or in a window, and update `docs/screenshot.png` when the change is visible.
