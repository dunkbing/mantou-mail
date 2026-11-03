# Mantou Mail

A desktop mail client written in TypeScript and Solid-style JSX, running on [Mantou](https://github.com/dunkbing/mantou): the app runs in a Bun Worker, and Mantou's Rust core lays it out and draws it on the GPU. No webview.

![Mantou Mail](docs/screenshot.png)

Conversations, Important/Other tabs, labels, snooze, search, replies and new messages with drafts, and undo, all from the keyboard (`?` lists the keys) or the mouse.

> **Early.** It runs on built-in sample mail (no accounts yet), and sending only files the message in Sent. What the app needs from Mantou, and how it works around it meanwhile, is in [docs/upstream.md](docs/upstream.md). Where it's going: [docs/agentic-design.md](docs/agentic-design.md).

## Run it

Needs [Bun](https://bun.sh) 1.4.4. `mantou-ui` comes from npm with a prebuilt native core for Linux (x64, arm64), macOS (arm64, x64) and Windows (x64), so there's nothing to compile.

```bash
bun install
```

```bash
bun run dev
```

## Keys

| Key | | Key | |
|---|---|---|---|
| `j` / `k` | older / newer message | `e` | archive |
| `1` / `2` | Important / Other | `i` | move to Inbox (from Archive, Snoozed, Trash) |
| `/` | search (Enter keeps the results, Esc goes back) | `#` | delete (in Trash: for good) |
| `c` | compose (`Enter` in To and Subject moves on) | `r` | reply (Esc keeps a draft) |
| `Ctrl`/`⌘`+`Enter` | send | `Enter` | open a draft (in Drafts) |
| `?` | keyboard shortcuts | `h` | snooze (then `1`–`4`) |
| `Esc` | close a panel, leave search | `l` | labels (then `1`–`4` toggle) |
| `z` | undo (sending too) | | |
| `s` | star | `u` | mark read / unread |

## Test

```bash
bun test
```

The tests run the app on a headless instance of Mantou's real core: layout, presses, keys, the wheel and captured pixels, with no window.
