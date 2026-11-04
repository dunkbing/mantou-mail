# Mantou Mail

A desktop mail client written in TypeScript and Solid-style JSX, running on [Mantou](https://github.com/dunkbing/mantou): the app runs in a Bun Worker, and Mantou's Rust core lays it out and draws it on the GPU. No webview.

![Mantou Mail](docs/screenshot.png)

IMAP accounts (Gmail, Outlook, iCloud, Fastmail, Yahoo, any IMAP server) synced to a local copy, conversations, Important/Other tabs, labels, snooze, search, replies, forwards and new messages with attachments and drafts, and undo, all from the keyboard (`?` lists the keys) or the mouse.

> **Early.** Real accounts sync their Inbox, Archive, Sent, Drafts and Trash (the newest 200 messages of each, and older ones on request: "Load older messages" at the end of the list), and reading, starring, archiving, deleting and moving go back to the server, also after working offline and quitting. Mail is sent over SMTP after a 10-second Undo Send, threaded as a reply where it is one, and filed in Sent. Attachments open with the system's app (saved to Downloads first); attaching uses the system's file picker (on Linux, zenity or kdialog; without either, the composer asks for a path). Snooze and labels are kept on this computer. Until an account is added, the app shows sample mail. What the app needs from Mantou, and how it works around it meanwhile, is in [docs/upstream.md](docs/upstream.md). Where it's going: [docs/agentic-design.md](docs/agentic-design.md).

## Run it

Needs [Bun](https://bun.sh) 1.4.4. `mantou-ui` comes from npm with a prebuilt native core for Linux (x64, arm64), macOS (arm64, x64) and Windows (x64), so there's nothing to compile.

```bash
bun install
```

```bash
bun run dev
```

**Add an account** with "Add your account" in the sidebar: email, password (many providers need an app password for IMAP and SMTP; the dialog says where to make one), and the IMAP and SMTP servers, guessed from the address. The password goes to the system keychain (Keychain, Secret Service, Credential Manager); without one, it's kept until you quit. Mail is kept in the app's data folder (`~/.local/share/mantou-mail`, `~/Library/Application Support/Mantou Mail`, `%APPDATA%\Mantou Mail`; `MANTOU_MAIL_HOME` to use another).

**To try it without a real account**, run an IMAP and SMTP server on this machine with the sample mail, and add `sam@northwind.dev` with password `testpass`, IMAP server `127.0.0.1` port `1143`, SMTP server `127.0.0.1` port `1025`, username `testuser` (mail you send to `sam@northwind.dev` arrives in its Inbox):

```bash
bun run demo-server
```

## Keys

| Key | | Key | |
|---|---|---|---|
| `j` / `k` | older / newer message | `e` | archive |
| `1` / `2` | Important / Other | `i` | move to Inbox (from Archive, Snoozed, Trash) |
| `/` | search (Enter keeps the results, Esc goes back) | `#` | delete (in Trash: for good) |
| `c` | compose (`Enter` in To and Subject moves on) | `r` | reply (Esc keeps a draft) |
| `f` | forward (with its attachments) | | |
| `Ctrl`/`⌘`+`Enter` | send | `Enter` | open a draft (in Drafts) |
| `?` | keyboard shortcuts | `h` | snooze (then `1`–`4`) |
| `Esc` | close a panel, leave search | `l` | labels (then `1`–`4` toggle) |
| `z` | undo (sending too) | | |
| `s` | star | `u` | mark read / unread |

## Test

```bash
bun test
```

`bun run perf` measures what the common interactions cost on the real core; the numbers are in [docs/performance.md](docs/performance.md).

The tests run the app on a headless instance of Mantou's real core: layout, presses, keys, the wheel and captured pixels, with no window. Real accounts are tested against an IMAP server in the test process ([hoodiecrow](https://github.com/postalsys/hoodiecrow-imap)): the first sync, changes reaching the server, new mail over IDLE, and the saved copy.
