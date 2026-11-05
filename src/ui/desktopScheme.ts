// Linux: follow the desktop's light or dark preference. Workaround for
// dunkbing/mantou#79: Mantou takes the scheme from winit, which never knows it
// on Linux, so the app asks the desktop itself and sets the scheme with
// setColorScheme. First the XDG desktop portal (GNOME, KDE and others publish
// org.freedesktop.appearance color-scheme there), else GNOME's own setting.
import { setColorScheme } from "mantou-ui";

export type Preference = "dark" | "light" | "system";

/** The portal's color-scheme, as gdbus prints it ("(<<uint32 1>>,)", or a SettingChanged line): 1 dark, 2 light, 0 none. */
export function fromPortal(out: string): Preference | null {
  const m = /uint32 (\d)/.exec(out);
  if (!m) return null;
  return m[1] === "1" ? "dark" : m[1] === "2" ? "light" : "system";
}

/** GNOME's color-scheme, as gsettings prints it ("'prefer-dark'", or "color-scheme: 'prefer-dark'" from monitor). */
export function fromGnome(out: string): Preference | null {
  const m = /'(prefer-dark|prefer-light|default)'/.exec(out);
  if (!m) return null;
  return m[1] === "prefer-dark" ? "dark" : m[1] === "prefer-light" ? "light" : "system";
}

const PORTAL = ["--session", "--dest", "org.freedesktop.portal.Desktop", "--object-path", "/org/freedesktop/portal/desktop"];
const READ = ["gdbus", "call", ...PORTAL, "--method", "org.freedesktop.portal.Settings.Read", "org.freedesktop.appearance", "color-scheme"];
const WATCH = ["gdbus", "monitor", ...PORTAL];
const GNOME = ["org.gnome.desktop.interface", "color-scheme"];

/** Runs a command: its output, or null when it fails or isn't there. */
async function output(cmd: string[]): Promise<string | null> {
  if (!Bun.which(cmd[0])) return null;
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out : null;
  } catch {
    return null;
  }
}

/** Runs a command that keeps printing, line by line, until stop() is called. */
function lines(cmd: string[], each: (line: string) => void): () => void {
  if (!Bun.which(cmd[0])) return () => {};
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  void (async () => {
    let rest = "";
    const decoder = new TextDecoder();
    for await (const chunk of p.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      const parts = rest.split("\n");
      rest = parts.pop()!;
      for (const l of parts) each(l);
    }
  })().catch(() => {});
  return () => p.kill();
}

export interface DesktopSchemeOptions {
  /** The system's commands (tests replace them). */
  output?: (cmd: string[]) => Promise<string | null>;
  lines?: (cmd: string[], each: (line: string) => void) => () => void;
  /** What to do with the preference (default: setColorScheme). */
  apply?: (p: Preference) => void;
  platform?: string;
}

/** Follows the desktop's preference, on Linux; returns what stops it. */
export async function followDesktopScheme(o: DesktopSchemeOptions = {}): Promise<() => void> {
  if ((o.platform ?? process.platform) !== "linux") return () => {};
  const run = o.output ?? output, watch = o.lines ?? lines, apply = o.apply ?? setColorScheme;
  const portal = fromPortal((await run(READ)) ?? "");
  if (portal) {
    apply(portal);
    return watch(WATCH, (l) => {
      if (!/SettingChanged/.test(l) || !/org\.freedesktop\.appearance/.test(l) || !/color-scheme/.test(l)) return;
      const p = fromPortal(l);
      if (p) apply(p);
    });
  }
  const gnome = fromGnome((await run(["gsettings", "get", ...GNOME])) ?? "");
  if (gnome) {
    apply(gnome);
    return watch(["gsettings", "monitor", ...GNOME], (l) => {
      const p = fromGnome(l);
      if (p) apply(p);
    });
  }
  return () => {};
}
