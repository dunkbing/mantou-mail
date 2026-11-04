// Colours, shared styles and the platform's shortcut key.
import { defineStyle } from "mantou-ui";

/** The platform's shortcut key, as the keyboard shows it. */
export const PRIMARY = process.platform === "darwin" ? "⌘" : "Ctrl";
export const SEND_KEYS = `${PRIMARY}+Enter`;

export const C = {
  text: "#111827",
  secondary: "#4b5563",
  muted: "#9ca3af",
  line: "#e5e7eb",
  faint: "#f3f4f6",
  sidebar: "#f7f7f9",
  accent: "#4f46e5",
  accentSoft: "#eef2ff",
  unread: "#3b82f6",
  star: "#f59e0b",
  backdrop: "#11182759",
};
/** Under a dialog, over the backdrop. */
export const dialogShadow = { x: 0, y: 16, blur: 48, spread: -8, color: "#1118274d" };
/** Under the Compose button. */
export const buttonShadow = { x: 0, y: 2, blur: 6, color: "#4f46e540" };

export const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

export const hline = defineStyle({ height: 1, flexShrink: 0, backgroundColor: C.line });
export const vline = defineStyle({ width: 1, flexShrink: 0, backgroundColor: C.line });
export const caption = defineStyle({ fontSize: 11, fontWeight: 600, color: C.muted });
export const small = defineStyle({ fontSize: 12, color: C.muted });

export const field = defineStyle({ fontSize: 14, color: C.text, placeholderColor: C.muted, caretColor: C.accent, selectionColor: "#c7d2fe" });
