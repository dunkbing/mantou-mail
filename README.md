# Mantou Mail

A desktop mail client written in TypeScript, running on [Mantou](https://github.com/dunkbing/mantou): native UI drawn on the GPU, no webview.

![Mantou Mail](docs/screenshot.png)

IMAP and SMTP accounts with a local copy that works offline, conversations, Important and Other, labels, snooze, search, reply and reply all, forwards, attachments, drafts, Send Later, Undo Send and undo. Everything works from the keyboard (`?` lists the keys).

Early: until you add an account, it shows sample mail.

## Run it

Needs [Bun](https://bun.sh) 1.4.4.

```bash
bun install
```

```bash
bun run dev
```

Add an account with "Add your account" in the sidebar. Gmail can sign in with Google once the app has a client ID ([docs/oauth.md](docs/oauth.md)); otherwise it takes an app password. Outlook doesn't work yet: Microsoft only allows signing in with Microsoft, which is next.

To try it without a real account, start a local IMAP and SMTP server with the sample mail, then add `sam@northwind.dev`, password `testpass`, servers `127.0.0.1` (IMAP port 1143, SMTP port 1025), username `testuser`:

```bash
bun run demo-server
```

To build one executable in `dist/`:

```bash
bun run build
```

## Test

```bash
bun test
```

## More

- [docs/upstream.md](docs/upstream.md): what the app needs from Mantou, and the workarounds meanwhile
- [docs/performance.md](docs/performance.md): what the common interactions cost
- [docs/agentic-design.md](docs/agentic-design.md): where it's going
- Icons: [Lucide](https://lucide.dev) (ISC)
