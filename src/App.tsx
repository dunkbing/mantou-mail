// Mantou Mail: a sidebar of mailboxes and labels, a message list, a reader
// that shows the whole conversation, and keyboard triage (? lists the keys).
import { Show, View, createEffect, createSignal, onKey, useUi, type Node } from "mantou-ui";
import { LABELS } from "./data";
import { createMail, usesTabs, type Mail } from "./state";
import { hline, vline } from "./ui/theme";
import { Sidebar } from "./ui/Sidebar";
import { Toolbar } from "./ui/Toolbar";
import { MessageList } from "./ui/MessageList";
import { Reader } from "./ui/Reader";
import { Composer } from "./ui/Compose";
import { Shortcuts } from "./ui/Shortcuts";
import { StatusBar } from "./ui/StatusBar";
import { Accounts } from "./ui/Accounts";
import type { Remote } from "./mail/remote";

export function App(props: { mail?: Mail; remote?: Remote }) {
  const m = props.mail ?? createMail();
  const ui = useUi();
  const [help, setHelp] = createSignal(false);
  const [accounts, setAccounts] = createSignal(false);
  let searchInput: Node | undefined;
  createEffect(() => {
    const unread = m.unread({ kind: "all" });
    ui.title(unread ? `Mantou Mail — ${unread} unread` : "Mantou Mail");
  });
  onKey((e) => {
    if (e.type !== "keyDown") return;
    if (accounts()) {
      if (e.key === "Escape") setAccounts(false);
      return; // the dialog's fields have the keys they use
    }
    // Composing: Esc closes (keeping a draft); Ctrl/⌘+Enter sends from anywhere in it
    // (the text field submits by itself; this covers the To and Subject lines and no focus).
    if (m.composing() || m.panel() === "reply") {
      if (e.key === "Escape") return m.composing() ? m.closeCompose() : m.closePanel();
      if (e.key === "Enter" && (e.ctrl || e.meta)) return void m.send();
      return; // keys the inputs didn't take aren't triage while a message is being written
    }
    if (e.ctrl || e.meta || e.alt) return;
    if (help()) {
      if (e.key === "Escape" || e.key === "?") setHelp(false);
      return;
    }
    // The search field keeps the keys it types with; Esc, Up and Down still come here.
    if (m.searching()) {
      switch (e.key) {
        case "Escape":
          m.cancelSearch();
          return searchInput?.blur();
        case "ArrowDown": return m.move(1);
        case "ArrowUp": return m.move(-1);
      }
      return;
    }
    const panel = m.panel();
    if (panel && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (panel === "snooze") return m.snooze(i);
      if (panel === "labels" && LABELS[i]) return m.toggleLabel(LABELS[i].id);
      return;
    }
    switch (e.key) {
      case "j": case "ArrowDown": return m.move(1);
      case "k": case "ArrowUp": return m.move(-1);
      case "e": return m.archive();
      case "i": return m.moveToInbox();
      case "#": case "Delete": case "Backspace": return m.remove();
      case "s": return m.star();
      case "u": return m.toggleUnread();
      case "r": return m.toggleReply();
      case "h": return m.togglePanel("snooze");
      case "l": return m.togglePanel("labels");
      case "z": return m.undo();
      case "/": return searchInput?.focus();
      case "c": return m.compose();
      case "f": return m.forward();
      case "Enter": return m.selected()?.folder === "drafts" && m.compose(m.selected()!);
      case "?": return setHelp(true);
      case "1": return usesTabs(m.mailbox()) && m.setTab("important");
      case "2": return usesTabs(m.mailbox()) && m.setTab("other");
      case "Escape":
        if (panel) return m.closePanel();
        if (m.mailbox().kind === "search") return m.cancelSearch();
        return;
    }
  });

  return (
    // minHeight 0: flex items are at least as tall as their content otherwise
    // (as in CSS), and the list and reader clip and scroll instead.
    <View style={{ flexGrow: 1, minHeight: 0, flexDirection: "row", backgroundColor: "#ffffff" }}>
      <Sidebar mail={m} remote={props.remote} searchRef={(n) => (searchInput = n)} onAccounts={() => setAccounts(true)} />
      <View style={vline} />
      <View style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Toolbar mail={m} />
        <View style={hline} />
        {/* flexBasis 0: the row's height comes from the window, not from what's scrolled inside it. */}
        <View style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, flexDirection: "row" }}>
          <MessageList mail={m} remote={props.remote} />
          <View style={vline} />
          <Reader mail={m} remote={props.remote} />
        </View>
        <View style={hline} />
        <StatusBar mail={m} remote={props.remote} onHelp={() => setHelp(true)} />
      </View>
      <Show when={m.composing()}>
        <Composer mail={m} remote={props.remote} />
      </Show>
      <Show when={accounts() && props.remote}>
        <Accounts remote={props.remote!} onClose={() => setAccounts(false)} />
      </Show>
      <Show when={help()}>
        <Shortcuts onClose={() => setHelp(false)} />
      </Show>
    </View>
  );
}
