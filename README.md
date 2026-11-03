# Mantou Mail

A desktop mail client written in TypeScript and Solid-style JSX, running on [Mantou](https://github.com/dunkbing/mantou): the app runs in a Bun Worker, and Mantou's Rust core lays it out and draws it on the GPU. No webview.

![Mantou Mail](docs/screenshot.png)

> **Early.** It runs on built-in sample mail (no accounts yet), and there's no compose or search until Mantou has text input.

## Run it

Needs [Bun](https://bun.sh) 1.4.4 and [Rust](https://rustup.rs) (to build Mantou's native core once).

```bash
bun install
```

```bash
bun run setup
```

```bash
bun run dev
```

## Keys

`j`/`k` move · `e` archive · `#` delete · `s` star · `u` unread · `r` quick reply (then `1`–`3`) · `z` undo · `1`/`2` Important/Other

## Test

```bash
bun test
```

The tests run the app on a headless instance of Mantou's real core: layout, presses, keys, the wheel and captured pixels, with no window.
