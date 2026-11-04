// The operating system's side of attachments: where downloads go, opening a
// file with its app, and the system's dialogs for choosing files to attach and
// where to save one (Mantou's).
import { existsSync } from "node:fs";
import { message, openFile, saveFile, type MessageOptions } from "mantou-ui";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

/** The Downloads folder (the home folder if there's none). */
export function downloadsDir(): string {
  const d = join(homedir(), "Downloads");
  return existsSync(d) ? d : homedir();
}

/** A file name in `dir` that isn't taken yet: "notes.pdf", then "notes (2).pdf"… */
export function freeName(dir: string, name: string): string {
  const clean = basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim() || "attachment";
  const ext = extname(clean), stem = clean.slice(0, clean.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? clean : `${stem} (${i})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
}

/** Opens a file with the app the system uses for it. Mantou has no call for this yet (dunkbing/mantou#21). */
export function openWithSystem(path: string) {
  const cmd = process.platform === "darwin" ? ["open", path] : process.platform === "win32" ? ["cmd", "/c", "start", "", path] : ["xdg-open", path];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}

const has = (tool: string) => Bun.which(tool) !== null;

/**
 * Whether the system can show Mantou's dialogs. They answer null both
 * when the person cancels and when there's no dialog to show (on Linux, no
 * desktop portal and no zenity), so the app guesses. Workaround for
 * dunkbing/mantou#28.
 */
export function hasDialogs(): boolean {
  if (process.platform !== "linux") return true;
  const portal = ["/usr/libexec/xdg-desktop-portal", "/usr/lib/xdg-desktop-portal"].some(existsSync);
  return has("zenity") || (portal && !!process.env.DBUS_SESSION_BUS_ADDRESS);
}

/**
 * Files to attach, from the system's file dialog: the chosen paths ([] if the
 * person cancelled), or null when there's no dialog (the composer then asks
 * for a path).
 */
export async function pickFiles(dialogs = hasDialogs()): Promise<string[] | null> {
  if (!dialogs) return null;
  return (await openFile({ title: "Attach files", multiple: true })) ?? [];
}

/**
 * Where to save a file, from the system's save dialog: a path, null if the
 * person cancelled, or `dir`'s next free name for it when there's no dialog.
 */
export async function pickSavePath(dir: string, name: string, dialogs = hasDialogs()): Promise<string | null> {
  if (!dialogs) return freeName(dir, name);
  return saveFile({ title: "Save attachment", directory: dir, name: basename(freeName(dir, name)) });
}

/** Asks with the system's message box: true for its first button. Where there's no message box, true. */
export async function confirm(options: MessageOptions, dialogs = hasDialogs()): Promise<boolean> {
  if (!dialogs) return true;
  return (await message(options)) === 0;
}

/** A MIME type from a file name, for attachments added here. */
export function typeOf(name: string): string {
  return Bun.file(name).type.split(";")[0] || "application/octet-stream";
}
