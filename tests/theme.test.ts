import { expect, test } from "bun:test";

test("the colours follow the colour scheme (dark, and back)", async () => {
  const p = Bun.spawn(["bun", "test", "tests/scheme.test.tsx"], { env: { ...process.env, SCHEME_CHECK: "1" }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  expect(await p.exited, out).toBe(0);
}, 60_000); // a second `bun test`: it starts a core of its own, slow while the rest of the suite runs
