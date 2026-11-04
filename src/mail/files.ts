// The operating system's side of attachments: where downloads go, opening a
// file with its app, and choosing files to attach. Bun runs the platform's own
// tools for these; nothing here is drawn by Mantou.
import { existsSync } from "node:fs";
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

/** Opens a file with the app the system uses for it. */
export function openWithSystem(path: string) {
  const cmd = process.platform === "darwin" ? ["open", path] : process.platform === "win32" ? ["cmd", "/c", "start", "", path] : ["xdg-open", path];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}

const has = (tool: string) => Bun.which(tool) !== null;

/**
 * The system's own file picker, for attaching files: osascript on macOS,
 * zenity or kdialog on Linux, PowerShell on Windows. Workaround for
 * dunkbing/mantou#21 (native dialogs). Resolves to the chosen paths ([] if
 * the person cancelled), or null when there's no picker to run.
 */
export async function pickFiles(): Promise<string[] | null> {
  let cmd: string[];
  let split: (out: string) => string[];
  if (process.platform === "darwin") {
    cmd = ["osascript", "-e", 'set fs to choose file with prompt "Attach files" with multiple selections allowed', "-e", 'set out to ""', "-e", "repeat with f in fs", "-e", "set out to out & POSIX path of f & linefeed", "-e", "end repeat", "-e", "out"];
    split = (o) => o.split("\n");
  } else if (process.platform === "win32") {
    const ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; $d.Title = 'Attach files'; if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join \"`n\" }";
    cmd = ["powershell", "-NoProfile", "-Command", ps];
    split = (o) => o.split(/\r?\n/);
  } else if (has("zenity")) {
    cmd = ["zenity", "--file-selection", "--multiple", "--separator=\n", "--title=Attach files"];
    split = (o) => o.split("\n");
  } else if (has("kdialog")) {
    cmd = ["kdialog", "--getopenfilename", homedir(), "--multiple", "--separate-output", "--title", "Attach files"];
    split = (o) => o.split("\n");
  } else return null;
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return split(out).map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** A MIME type from a file name, for attachments added here. */
export function typeOf(name: string): string {
  return Bun.file(name).type.split(";")[0] || "application/octet-stream";
}
