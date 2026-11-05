# Performance

`bun run perf` (`bench/perf.bench.tsx`) runs the app on Mantou's real core, headless at 1200 × 760, and reports what the common interactions cost. Each time is one interaction's wall time: the app's JS plus the core's layout and scene build, as one headless step. Ops are what JS committed; nodes are the tree's size afterwards. Run it before and after a change to what's on screen, and add the numbers here when they move.

Latest run: 5 November 2026, mantou-ui 0.3.1, Linux (Ubuntu 24.04, Mesa lavapipe), with the message list on `<List>` (rows only for what's in view). The table before it was on macOS (Apple M4), so compare the ops, layouts and nodes rather than the times.

| mailbox | interaction | ms | ops | layouts | nodes |
|---|---|---:|---:|---:|---:|
| sample (31) | mount | 83 | 2,525 | 2 | 336 |
| sample (31) | `j` (next message) | 3.5 | 68 | 0.5 | 312 |
| sample (31) | wheel 120 px | 0.42 | 0 | 0 | 312 |
| sample (31) | switch mailbox | 8.8 | 504 | 1 | 333 |
| sample (31) | archive + undo | 18 | 1,023 | 2 | 333 |
| sample (31) | search: type a key | 4.6 | 386 | 1.3 | 119 |
| 2,000 in inbox | mount | 36 | 2,412 | 2 | 319 |
| 2,000 in inbox | `j` | 8.6 | 215 | 1.7 | 386 |
| 2,000 in inbox | wheel 120 px | 1.9 | 191 | 1 | 386 |
| 2,000 in inbox | switch mailbox | 8.9 | 582 | 1.1 | 319 |
| 2,000 in inbox | archive + undo | 20 | 950 | 2 | 319 |
| 2,000 in inbox | search: type a key | 8.1 | 384 | 1.3 | 121 |

The table before, on macOS with mantou-ui 0.1.7 and the list rendered 60 rows at a time:

| mailbox | interaction | ms | ops | layouts | nodes |
|---|---|---:|---:|---:|---:|
| sample (31) | mount | 39.7 | 2,389 | 1 | 325 |
| sample (31) | `j` (next message) | 0.83 | 80 | 0.5 | 301 |
| sample (31) | wheel 120 px | 0.11 | 0 | 0 | 301 |
| sample (31) | switch mailbox | 1.8 | 1,262 | 1 | 322 |
| sample (31) | archive + undo | 1.5 | 543 | 2 | 322 |
| sample (31) | search: type a key | 1.3 | 658 | 1.2 | 120 |
| 2,000 in inbox | mount | 17.9 | 7,131 | 1 | 1,024 |
| 2,000 in inbox | `j` | 2.3 | 191 | 1 | 1,023 |
| 2,000 in inbox | wheel 120 px | 0.28 | 0 | 0 | 1,023 |
| 2,000 in inbox | switch mailbox | 7.4 | 6,682 | 1 | 1,024 |
| 2,000 in inbox | archive + undo | 3.7 | 500 | 2 | 1,024 |
| 2,000 in inbox | search: type a key | 4.5 | 2,348 | 1.2 | 122 |

## What changed it

| change | 2,000 in inbox before → after |
|---|---|
| The list on `<List>` (mantou-ui 0.3.1): rows only for what's in view, placed by their known heights | mount 7,131 → 2,412 ops and 1,024 → 319 nodes; switch mailbox 6,682 → 582 ops; a wheel turn 0 → 191 ops (rows come and go as it scrolls); archive + undo 500 → 950 ops (every row's place moves) |
| Rows rendered a page (60) at a time, more as the scroll nears the end (`MessageList`, workaround for a virtualised list, [dunkbing/mantou#19](https://github.com/dunkbing/mantou/issues/19)) | mount 1,006 → 54 ms, 15,721 → 990 nodes; `j` 96 → 11 ms; wheel 49 → 2.5 ms; switch mailbox 558 → 31 ms |
| Icons drawn from views ([dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8)) | +77 nodes and about +660 ops at mount; interactions unchanged |
| mantou-ui 0.1.1 → 0.1.3: `<Scroll>` instead of negative margins, and the text-cost fix ([#9](https://github.com/dunkbing/mantou/issues/9)) | a wheel turn: 2 ops and a relayout → no ops and no layout (the core scrolls); `j` 10.4 → 5.6 ms; switch mailbox 31 → 19 ms; mount 58 → 31 ms |

mantou-ui 0.1.4 and the icon font (4 November), measured against 0.1.3 with the views-drawn icons on the same machine, at the same time (this machine was about 40% slower than for the table above, so the times aren't comparable with it): an icon is one text node instead of up to 10 views, so mount is 392 → 325 nodes and 2,924 → 2,388 ops for the sample mail, and 1,103 → 1,024 nodes and 7,762 → 7,130 ops for 2,000 messages; archive + undo with 2,000 is 15.7 → 11.4 ms; the other times are within the noise. The shadows cost nothing measurable.

Attachments and Forward (4 November) added about 8 nodes and 3% more ops at mount (a paperclip check per row, the Forward button); interactions unchanged. Mount times here vary ±10 ms between runs.

## What's Mantou's

- Nothing open. The list is virtualized ([#19](https://github.com/dunkbing/mantou/issues/19), [#31](https://github.com/dunkbing/mantou/issues/31), [#50](https://github.com/dunkbing/mantou/issues/50); the app keeps a row's last message for [#80](https://github.com/dunkbing/mantou/issues/80)). Fixed in 0.1.3: [#9](https://github.com/dunkbing/mantou/issues/9) (text laid out for every node, and the cache past 4,096) and [#5](https://github.com/dunkbing/mantou/issues/5) (scrolling re-laid out the content).
