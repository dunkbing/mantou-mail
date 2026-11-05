// Linux: following the desktop's light or dark preference through the XDG
// portal or GNOME's setting (src/ui/desktopScheme.ts), with the commands faked.
import { expect, test } from "bun:test";
import { followDesktopScheme, fromGnome, fromPortal, type Preference } from "../src/ui/desktopScheme";

test("what the portal and gsettings print", () => {
  expect(fromPortal("(<<uint32 1>>,)\n")).toBe("dark");
  expect(fromPortal("(<<uint32 2>>,)")).toBe("light");
  expect(fromPortal("(<<uint32 0>>,)")).toBe("system");
  expect(fromPortal("/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.freedesktop.appearance', 'color-scheme', <uint32 1>)")).toBe("dark");
  expect(fromPortal("Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown")).toBeNull();
  expect(fromGnome("'prefer-dark'\n")).toBe("dark");
  expect(fromGnome("color-scheme: 'default'")).toBe("system");
  expect(fromGnome("No such schema “org.gnome.desktop.interface”")).toBeNull();
});

function fake(answers: Record<string, string | null>) {
  const applied: Preference[] = [];
  const watchers: { cmd: string; each: (l: string) => void; stopped: boolean }[] = [];
  return {
    applied,
    watchers,
    opts: {
      platform: "linux",
      apply: (p: Preference) => void applied.push(p),
      output: async (cmd: string[]) => answers[cmd[0] + " " + cmd[1]] ?? null,
      lines: (cmd: string[], each: (l: string) => void) => {
        const w = { cmd: cmd.slice(0, 2).join(" "), each, stopped: false };
        watchers.push(w);
        return () => void (w.stopped = true);
      },
    },
  };
}

test("the portal first: its answer now, and its SettingChanged later (other settings ignored)", async () => {
  const f = fake({ "gdbus call": "(<<uint32 1>>,)", "gsettings get": "'default'" });
  const stop = await followDesktopScheme(f.opts);
  expect(f.applied).toEqual(["dark"]);
  expect(f.watchers.map((w) => w.cmd)).toEqual(["gdbus monitor"]);
  f.watchers[0].each("/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.gnome.desktop.interface', 'font-name', <'Cantarell 11'>)");
  f.watchers[0].each("/org/freedesktop/portal/desktop: org.freedesktop.portal.Settings.SettingChanged ('org.freedesktop.appearance', 'color-scheme', <uint32 0>)");
  expect(f.applied).toEqual(["dark", "system"]);
  stop();
  expect(f.watchers[0].stopped).toBe(true);
});

test("no portal: GNOME's setting; neither: nothing, and nothing on other systems", async () => {
  const g = fake({ "gsettings get": "'prefer-dark'" });
  await followDesktopScheme(g.opts);
  expect(g.applied).toEqual(["dark"]);
  expect(g.watchers.map((w) => w.cmd)).toEqual(["gsettings monitor"]);
  g.watchers[0].each("color-scheme: 'prefer-light'");
  expect(g.applied).toEqual(["dark", "light"]);
  const none = fake({});
  await followDesktopScheme(none.opts);
  expect(none.applied).toEqual([]);
  expect(none.watchers).toEqual([]);
  const mac = fake({ "gdbus call": "(<<uint32 1>>,)" });
  await followDesktopScheme({ ...mac.opts, platform: "darwin" });
  expect(mac.applied).toEqual([]);
});

test("on this machine: with no portal and no GNOME schema it does nothing, and doesn't throw", async () => {
  const applied: Preference[] = [];
  const stop = await followDesktopScheme({ apply: (p) => void applied.push(p) });
  stop();
  expect(Array.isArray(applied)).toBe(true);
});
