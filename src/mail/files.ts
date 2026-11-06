// The operating system's side of attachments: where downloads go, opening a
// file with its app, and the system's dialogs for choosing files to attach and
// where to save one (Mantou's).
import { existsSync } from "node:fs";
import { message, openExternal, openFile, saveFile, type MessageOptions } from "mantou-ui";
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

/** Opens a file (or a URL) with the app the system uses for it. */
export const openWithSystem = (target: string) => void openExternal(target);

// Mantou's dialogs answer null when the person cancels, and reject when the system can't show one (Linux
// with no desktop portal and no zenity): then the app does without (dunkbing/mantou#28, fixed in 0.5.0).

/**
 * Files to attach, from the system's file dialog: the chosen paths ([] if the
 * person cancelled), or null when there's no dialog (the composer then asks
 * for a path).
 */
export async function pickFiles(): Promise<string[] | null> {
  try {
    return (await openFile({ title: "Attach files", multiple: true })) ?? [];
  } catch {
    return null;
  }
}

/**
 * Where to save a file, from the system's save dialog: a path, null if the
 * person cancelled, or `dir`'s next free name for it when there's no dialog.
 */
export async function pickSavePath(dir: string, name: string): Promise<string | null> {
  try {
    return await saveFile({ title: "Save attachment", directory: dir, name: basename(freeName(dir, name)) });
  } catch {
    return freeName(dir, name);
  }
}

/** Asks with the system's message box: true for its first button. Where there's no message box, true. */
export async function confirm(options: MessageOptions): Promise<boolean> {
  try {
    return (await message(options)) === 0;
  } catch {
    return true;
  }
}

/** A MIME type from a file name, for attachments added here. */
export function typeOf(name: string): string {
  return Bun.file(name).type.split(";")[0] || "application/octet-stream";
}
