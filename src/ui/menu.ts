// The app menu (the menu bar on macOS; Mantou doesn't show one on Linux or
// Windows yet). Each item's id is a command App.tsx runs, the same as its key.
// Accelerators are only ⌘ ones: a bare letter would be taken from the inputs.
import type { MenuItem } from "mantou-ui";

export type Command =
  | "compose" | "accounts" | "reply" | "forward" | "archive" | "inbox" | "delete" | "snooze" | "label"
  | "star" | "unread" | "undo" | "search" | "important" | "other" | "next" | "previous" | "shortcuts";

const item = (id: Command, label: string, accelerator?: string): MenuItem => ({ id, label, ...(accelerator && { accelerator }) });
const sep: MenuItem = { separator: true };

export const APP_MENU: MenuItem[] = [
  { label: "Mantou Mail", items: [{ role: "about" }, sep, item("accounts", "Accounts…", "cmd+,"), sep, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, sep, { role: "quit" }] },
  { label: "File", items: [item("compose", "New Message", "cmd+n")] },
  { label: "Edit", items: [{ role: "undo" }, { role: "redo" }, sep, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }, sep, item("search", "Find", "cmd+f")] },
  {
    label: "Message",
    items: [
      item("reply", "Reply", "cmd+r"), item("forward", "Forward", "cmd+shift+f"), sep,
      item("archive", "Archive"), item("inbox", "Move to Inbox"), item("delete", "Delete"), sep,
      item("snooze", "Snooze…"), item("label", "Label…"), item("star", "Star"), item("unread", "Mark as Read or Unread"), sep,
      item("undo", "Undo Last Action"),
    ],
  },
  { label: "View", items: [item("important", "Important", "cmd+1"), item("other", "Other", "cmd+2"), sep, item("next", "Next Conversation"), item("previous", "Previous Conversation")] },
  { label: "Window", items: [{ role: "minimize" }, { role: "zoom" }, { role: "fullscreen" }] },
  { label: "Help", items: [item("shortcuts", "Keyboard Shortcuts", "cmd+/")] },
];
