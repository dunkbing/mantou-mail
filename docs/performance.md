# Performance

`bun run perf` (`bench/perf.bench.tsx`) runs the app on Mantou's real core, headless at 1200 × 760, and reports what the common interactions cost. Each time is one interaction's wall time: the app's JS plus the core's layout and scene build, as one headless step. Ops are what JS committed; nodes are the tree's size afterwards. Run it before and after a change to what's on screen, and add the numbers here when they move.

Latest run: 4 November 2026, mantou-ui 0.1.3, Linux, with `<Scroll>` (the core scrolls) and progressive rows.

| mailbox | interaction | ms | ops | layouts | nodes |
|---|---|---:|---:|---:|---:|
| sample (31) | mount | 58 | 2,773 | 1 | 375 |
| sample (31) | `j` (next message) | 1.7 | 76 | 0.5 | 351 |
| sample (31) | wheel 120 px | 0.2 | 0 | 0 | 351 |
| sample (31) | switch mailbox | 6.1 | 1,250 | 1 | 372 |
| sample (31) | archive + undo | 3.7 | 543 | 2 | 372 |
| sample (31) | search: type a key | 4.2 | 707 | 1.2 | 178 |
| 2,000 in inbox | mount | 31 | 7,449 | 1 | 1,068 |
| 2,000 in inbox | `j` | 5.6 | 180 | 1 | 1,067 |
| 2,000 in inbox | wheel 120 px | 0.6 | 0 | 0 | 1,067 |
| 2,000 in inbox | switch mailbox | 19 | 6,586 | 1 | 1,068 |
| 2,000 in inbox | archive + undo | 8.6 | 488 | 2 | 1,068 |
| 2,000 in inbox | search: type a key | 10 | 2,382 | 1.2 | 180 |

## What changed it

| change | 2,000 in inbox before → after |
|---|---|
| Rows rendered a page (60) at a time, more as the scroll nears the end (`MessageList`, workaround for a virtualised list, [dunkbing/mantou#19](https://github.com/dunkbing/mantou/issues/19)) | mount 1,006 → 54 ms, 15,721 → 990 nodes; `j` 96 → 11 ms; wheel 49 → 2.5 ms; switch mailbox 558 → 31 ms |
| Icons drawn from views ([dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8)) | +77 nodes and about +660 ops at mount; interactions unchanged |
| mantou-ui 0.1.1 → 0.1.3: `<Scroll>` instead of negative margins, and the text-cost fix ([#9](https://github.com/dunkbing/mantou/issues/9)) | a wheel turn: 2 ops and a relayout → no ops and no layout (the core scrolls); `j` 10.4 → 5.6 ms; switch mailbox 31 → 19 ms; mount 58 → 31 ms |

Attachments and Forward (4 November) added about 8 nodes and 3% more ops at mount (a paperclip check per row, the Forward button); interactions unchanged. Mount times here vary ±10 ms between runs.

## What's Mantou's

- **[dunkbing/mantou#19](https://github.com/dunkbing/mantou/issues/19)** (a virtualised list): until it ships, the list renders 60 rows at a time; every rendered row is about 8 nodes and 53 ops. Fixed in 0.1.3: [#9](https://github.com/dunkbing/mantou/issues/9) (text laid out for every node, and the cache past 4,096) and [#5](https://github.com/dunkbing/mantou/issues/5) (scrolling re-laid out the content).
