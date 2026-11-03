// Where the app keeps its data: MANTOU_MAIL_HOME if set, else the platform's
// usual place for app data.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  const dir =
    process.env.MANTOU_MAIL_HOME ??
    (process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Mantou Mail")
      : process.platform === "win32"
        ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Mantou Mail")
        : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "mantou-mail"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
