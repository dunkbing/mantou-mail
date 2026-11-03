# Performance

`bun run perf` (`bench/perf.bench.tsx`) runs the app on Mantou's real core, headless at 1200 × 760, and reports what the common interactions cost. Each time is one interaction's wall time: the app's JS plus the core's layout and scene build, as one headless step. Ops are what JS committed; nodes are the tree's size afterwards. Run it before and after a change to what's on screen, and add the numbers here when they move.

Latest run: 3 November 2026, mantou-ui 0.1.1, Linux, after progressive rows and icons.

| mailbox | interaction | ms | ops | nodes |
|---|---|---:|---:|---:|
| sample (31) | mount | 100 | 2,774 | 374 |
| sample (31) | `j` (next message) | 3.8 | 76 | 350 |
| sample (31) | wheel 120 px | 1.0 | 2 | 350 |
| sample (31) | switch mailbox | 11 | 1,249 | 371 |
| sample (31) | archive + undo | 8.7 | 541 | 371 |
| sample (31) | search: type a key | 7.3 | 707 | 177 |
| 2,000 in inbox | mount | 58 | 7,450 | 1,067 |
| 2,000 in inbox | `j` | 10 | 179 | 1,066 |
| 2,000 in inbox | wheel 120 px | 3.2 | 2 | 1,066 |
| 2,000 in inbox | switch mailbox | 31 | 6,584 | 1,067 |
| 2,000 in inbox | archive + undo | 22 | 486 | 1,067 |
| 2,000 in inbox | search: type a key | 17 | 2,382 | 179 |

## What changed it

| change | 2,000 in inbox before → after |
|---|---|
| Rows rendered a page (60) at a time, more as the scroll nears the end (`MessageList`, workaround for [dunkbing/mantou#5](https://github.com/dunkbing/mantou/issues/5)) | mount 1,006 → 54 ms, 15,721 → 990 nodes; `j` 96 → 11 ms; wheel 49 → 2.5 ms; switch mailbox 558 → 31 ms |
| Icons drawn from views ([dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8)) | +77 nodes and about +660 ops at mount; interactions unchanged |

## What's Mantou's

- **[dunkbing/mantou#9](https://github.com/dunkbing/mantou/issues/9):** every commit lays out the text of every Text node, visible or not, and past 4,096 Text nodes the layout cache clears itself on every commit. A commit that only scrolls goes from 28 ms at 4,000 Text nodes to 208 ms at 4,200. The app stays well under that with progressive rows (about 330 Text nodes for a full screen), but a long conversation or a search with many results renders more.
- **[dunkbing/mantou#5](https://github.com/dunkbing/mantou/issues/5):** scrolling re-lays out the scrolled content on every wheel event (a margin change) instead of moving a layer, and without a virtualised list every rendered row is a real node.
