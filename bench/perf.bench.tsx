// bun run perf: how much work the app's common interactions cost, on Mantou's
// real core (headless): wall time per interaction (JS + the core's layout and
// scene, as one headless step), ops committed, layouts, nodes. Run it before
// and after a change that touches what's on screen. Not part of `bun test`.
import { afterAll, test } from "bun:test";
import { mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { App } from "../src/App";
import { sampleMessages, type Message } from "../src/data";
import { createMail } from "../src/state";

const rows: string[][] = [];
afterAll(() => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  console.log("\n" + rows.map((r) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  ")).join("\n") + "\n");
});

/** n copies of the sample inbox, spread over time, for a big mailbox. */
function bigMailbox(n: number): Message[] {
  const base = sampleMessages().filter((m) => m.folder === "inbox");
  return Array.from({ length: n }, (_, i) => {
    const m = base[i % base.length];
    return { ...m, id: i + 1, thread: undefined, date: new Date(m.date.getTime() - Math.floor(i / base.length) * 86_400_000), subject: `${m.subject} (${i + 1})` };
  });
}

function measure(label: string, messages: Message[]) {
  const h = new HeadlessCore({ width: 1200, height: 760 });
  const mail = createMail(messages);
  let t = performance.now();
  mount(h.ui, () => <App mail={mail} />);
  h.step();
  const mountMs = performance.now() - t;
  const nodes = h.ui.nodes.size;
  const s0 = h.stats();
  rows.push([label, "mount", mountMs.toFixed(1), String(s0.ops), String(s0.layouts), String(nodes)]);
  const run = (what: string, n: number, fn: (i: number) => void) => {
    const before = h.stats();
    t = performance.now();
    for (let i = 0; i < n; i++) fn(i);
    const ms = (performance.now() - t) / n;
    const after = h.stats();
    rows.push([label, what, ms.toFixed(2), ((after.ops - before.ops) / n).toFixed(0), ((after.layouts - before.layouts) / n).toFixed(1), String(h.ui.nodes.size)]);
  };
  run("j (next message)", 20, () => h.key("j"));
  run("wheel 120 px", 20, (i) => h.wheel(400, 400, i % 2 ? -120 : 120));
  run("switch mailbox", 10, (i) => h.key(i % 2 ? "1" : "2"));
  run("archive + undo", 10, () => (h.key("e"), h.key("z")));
  run("search: type a key", 6, (i) => {
    if (i === 0) h.key("/");
    h.key("abcdef"[i]);
  });
  h.key("Escape");
  h.free();
}

test("perf", () => {
  rows.push(["mailbox", "interaction", "ms each", "ops", "layouts", "nodes"]);
  measure("sample (31)", sampleMessages());
  measure("2,000 in inbox", bigMailbox(2000));
}, 120_000);
