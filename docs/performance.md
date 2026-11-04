# Performance

`bun run perf` (`bench/perf.bench.tsx`) runs the app on Mantou's real core, headless at 1200 × 760, and reports what the common interactions cost. Each time is one interaction's wall time: the app's JS plus the core's layout and scene build, as one headless step. Ops are what JS committed; nodes are the tree's size afterwards. Run it before and after a change to what's on screen, and add the numbers here when they move.

Latest run: 4 November 2026, mantou-ui 0.1.7, macOS (Apple M4), with `<Scroll>` (the core scrolls) and progressive rows. Earlier tables were on Linux, so compare the ops, layouts and nodes rather than the times.

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
| Rows rendered a page (60) at a time, more as the scroll nears the end (`MessageList`, workaround for a virtualised list, [dunkbing/mantou#19](https://github.com/dunkbing/mantou/issues/19)) | mount 1,006 → 54 ms, 15,721 → 990 nodes; `j` 96 → 11 ms; wheel 49 → 2.5 ms; switch mailbox 558 → 31 ms |
| Icons drawn from views ([dunkbing/mantou#8](https://github.com/dunkbing/mantou/issues/8)) | +77 nodes and about +660 ops at mount; interactions unchanged |
| mantou-ui 0.1.1 → 0.1.3: `<Scroll>` instead of negative margins, and the text-cost fix ([#9](https://github.com/dunkbing/mantou/issues/9)) | a wheel turn: 2 ops and a relayout → no ops and no layout (the core scrolls); `j` 10.4 → 5.6 ms; switch mailbox 31 → 19 ms; mount 58 → 31 ms |

mantou-ui 0.1.4 and the icon font (4 November), measured against 0.1.3 with the views-drawn icons on the same machine, at the same time (this machine was about 40% slower than for the table above, so the times aren't comparable with it): an icon is one text node instead of up to 10 views, so mount is 392 → 325 nodes and 2,924 → 2,388 ops for the sample mail, and 1,103 → 1,024 nodes and 7,762 → 7,130 ops for 2,000 messages; archive + undo with 2,000 is 15.7 → 11.4 ms; the other times are within the noise. The shadows cost nothing measurable.

Attachments and Forward (4 November) added about 8 nodes and 3% more ops at mount (a paperclip check per row, the Forward button); interactions unchanged. Mount times here vary ±10 ms between runs.

## What's Mantou's

- **[dunkbing/mantou#50](https://github.com/dunkbing/mantou/issues/50)** (`<List>` with rows of different heights, [#31](https://github.com/dunkbing/mantou/issues/31), is in 0.1.7 but throws when its items get fewer): until then, the list renders 60 rows at a time; every rendered row is about 8 nodes and 53 ops. Fixed in 0.1.3: [#9](https://github.com/dunkbing/mantou/issues/9) (text laid out for every node, and the cache past 4,096) and [#5](https://github.com/dunkbing/mantou/issues/5) (scrolling re-laid out the content).
