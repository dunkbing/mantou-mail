// Colours, shared styles and the platform's shortcut key.
import { defineTheme } from "mantou-ui";

/** The platform's shortcut key, as the keyboard shows it. */
export const PRIMARY = process.platform === "darwin" ? "⌘" : "Ctrl";
export const SEND_KEYS = `${PRIMARY}+Enter`;

export const C = defineTheme({
  light: {
    text: "#111827", secondary: "#4b5563", muted: "#9ca3af", line: "#e5e7eb", faint: "#f3f4f6", sidebar: "#f7f7f9",
    accent: "#4f46e5", accentSoft: "#eef2ff", accentText: "#3730a3", unread: "#3b82f6", star: "#f59e0b", backdrop: "#11182759",
    surface: "#ffffff", subtle: "#fafafa", body: "#1f2937", selection: "#c7d2fe",
    danger: "#b91c1c", dangerSoft: "#fef2f2", warn: "#9a3412", warnSoft: "#fff7ed", sending: "#92400e", sendingSoft: "#fef3c7", info: "#075985", infoSoft: "#f0f9ff",
  },
  dark: {
    text: "#e5e7eb", secondary: "#9ca3af", muted: "#6b7280", line: "#2c2f38", faint: "#262932", sidebar: "#17191e",
    accent: "#6366f1", accentSoft: "#26294d", accentText: "#a5b4fc", unread: "#60a5fa", star: "#fbbf24", backdrop: "#000000a6",
    surface: "#1c1e24", subtle: "#181a1f", body: "#d1d5db", selection: "#3d4180",
    danger: "#f87171", dangerSoft: "#3b1d1f", warn: "#fb923c", warnSoft: "#3a2616", sending: "#fbbf24", sendingSoft: "#3a3015", info: "#7dd3fc", infoSoft: "#162a38",
  },
});
/** Under a dialog, over the backdrop. */
export const dialogShadow = { x: 0, y: 16, blur: 48, spread: -8, color: "#1118274d" };
/** Under the Compose button. */
export const buttonShadow = { x: 0, y: 2, blur: 6, color: "#4f46e540" };

export const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

// Functions, called in the JSX: a defineStyle shared style doesn't follow the colour scheme (dunkbing/mantou#53).
export const hline = () => ({ height: 1, flexShrink: 0, backgroundColor: C.line });
export const vline = () => ({ width: 1, flexShrink: 0, backgroundColor: C.line });
export const caption = () => ({ fontSize: 11, fontWeight: 600, color: C.muted });
export const small = () => ({ fontSize: 12, color: C.muted });
export const field = () => ({ fontSize: 14, color: C.text, placeholderColor: C.muted, caretColor: C.accent, selectionColor: C.selection });
