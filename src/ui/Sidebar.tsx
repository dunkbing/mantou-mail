// The sidebar: Compose, search, mailboxes and labels.
import { For, Input, Show, Text, View, win, type Node } from "mantou-ui";
import { LABELS } from "../data";
import { sameMailbox, type Mail, type Mailbox } from "../state";
import { C, caption, buttonShadow } from "./theme";
import { Kbd } from "./common";
import { Icon, type IconName } from "./icons";
import { STATE_COLOR } from "./Accounts";
import type { Remote } from "../mail/remote";

export function SidebarItem(props: { mail: Mail; mailbox: Mailbox; name: string; icon?: IconName; count?: number; dot?: string; indent?: boolean }) {
  const active = () => sameMailbox(props.mail.mailbox(), props.mailbox);
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 30, paddingLeft: props.indent ? 36 : 10, paddingRight: 10, borderRadius: 6, backgroundColor: active() ? C.accentSoft : "transparent" }}
      onPress={() => props.mail.open(props.mailbox)}
    >
      <Show when={props.icon}>
        <Icon name={props.icon!} color={active() ? C.accent : C.secondary} />
      </Show>
      <Show when={props.dot}>
        <View style={{ width: props.indent ? 8 : 16, height: 8, flexShrink: 0, alignItems: "center" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.dot ?? "transparent" }} />
        </View>
      </Show>
      <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, fontWeight: active() ? 600 : 500, color: active() ? C.accent : C.text, maxLines: 1 }}>{props.name}</Text>
      <Show when={(props.count ?? 0) > 0}>
        <Text style={{ fontSize: 12, fontWeight: 500, color: active() ? C.accent : C.muted }}>{props.count}</Text>
      </Show>
    </View>
  );
}

/**
 * The search field: `/` focuses it, typing searches as you go, Enter keeps
 * the results and hands the keys back to triage, Esc goes back.
 */
export function SearchField(props: { mail: Mail; ref: (n: Node) => void }) {
  const m = props.mail;
  let input: Node | undefined;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, flexShrink: 0, marginBottom: 12, paddingLeft: 10, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: m.searching() ? C.accent : C.line, backgroundColor: C.surface }}
      onPress={() => input?.focus()}
    >
      <Icon name="search" size={14} color={m.searching() ? C.accent : C.muted} />
      <Input
        ref={(n) => props.ref((input = n))}
        value={m.query()}
        placeholder="Search mail"
        onChange={m.setQuery}
        onFocus={m.startSearch}
        onBlur={m.endSearch}
        onSubmit={() => {
          if (!m.query().trim()) m.cancelSearch();
          input?.blur();
        }}
        style={{ flexGrow: 1, flexBasis: 0, height: 28, paddingLeft: 6, fontSize: 13, color: C.text, placeholderColor: C.muted, caretColor: C.accent }}
      />
      <Kbd text={m.searching() ? "Esc" : "/"} />
    </View>
  );
}

export function Sidebar(props: { mail: Mail; remote?: Remote; searchRef: (n: Node) => void; onAccounts: () => void }) {
  const m = props.mail;
  return (
    <View style={{ width: 228, flexShrink: 0, paddingLeft: 12, paddingRight: 12, gap: 2, backgroundColor: C.sidebar }}>
      {/* Under the traffic lights (titleBar: "overlay" in main.tsx); it moves the window (painted: an empty view without a background isn't hit, dunkbing/mantou#56). */}
      <View dragRegion style={{ height: win.safeArea.top + 10, flexShrink: 0, marginLeft: -12, marginRight: -12, backgroundColor: C.sidebar }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingBottom: 14 }}>
        <View style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, backgroundColor: C.accent, justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontWeight: 700, fontSize: 14, textAlign: "center" }}>M</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Mantou Mail</Text>
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 34, flexShrink: 0, marginBottom: 10, borderRadius: 7, backgroundColor: C.accent, boxShadow: buttonShadow }}
        onPress={() => m.compose()}
      >
        <Icon name="plus" size={14} color="#ffffff" />
        <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>Compose</Text>
        <Text style={{ fontSize: 11, fontWeight: 600, color: "#c7d2fe" }}>C</Text>
      </View>
      <SearchField mail={m} ref={props.searchRef} />
      <SidebarItem mail={m} mailbox={{ kind: "ask" }} name="Ask" icon="search" />
      <SidebarItem mail={m} mailbox={{ kind: "queue" }} name="Queue" icon="check" count={m.proposals().length} />
      <SidebarItem mail={m} mailbox={{ kind: "all" }} name="All inboxes" icon="inboxes" count={m.unread({ kind: "all" })} />
      <For each={m.accounts()}>
        {(a) => {
          // A dot for an account that isn't up to date (syncing, offline, needs its password).
          const dot = () => {
            const s = props.remote?.statuses()[a.id]?.state;
            return s && s !== "ready" ? STATE_COLOR[s] : undefined;
          };
          return <SidebarItem mail={m} mailbox={{ kind: "account", id: a.id }} name={a.name} dot={dot()} count={m.unread({ kind: "account", id: a.id })} indent />;
        }}
      </For>
      <Show when={props.remote}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 36, paddingRight: 10, borderRadius: 6 }} onPress={props.onAccounts}>
          <Icon name={m.accounts()[0]?.sample ? "plus" : "person"} size={12} color={m.accounts()[0]?.sample ? C.accent : C.muted} />
          <Text style={{ flexShrink: 1, fontSize: 12, fontWeight: 500, color: m.accounts()[0]?.sample ? C.accent : C.muted, maxLines: 1 }}>{m.accounts()[0]?.sample ? "Add your account" : "Manage accounts"}</Text>
        </View>
      </Show>
      <View style={{ height: 10 }} />
      <SidebarItem mail={m} mailbox={{ kind: "starred" }} name="Starred" icon="starOutline" count={m.count({ kind: "starred" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "snoozed" }} name="Snoozed" icon="clock" count={m.count({ kind: "folder", folder: "snoozed" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "drafts" }} name="Drafts" icon="doc" count={m.count({ kind: "folder", folder: "drafts" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "scheduled" }} name="Scheduled" icon="calendar" count={m.count({ kind: "folder", folder: "scheduled" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "sent" }} name="Sent" icon="sent" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "archive" }} name="Archive" icon="archive" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "trash" }} name="Trash" icon="trash" count={m.count({ kind: "folder", folder: "trash" })} />
      <View style={{ height: 16 }} />
      <Text style={[caption(), { paddingLeft: 10, paddingBottom: 6 }]}>LABELS</Text>
      <For each={LABELS}>
        {(l) => <SidebarItem mail={m} mailbox={{ kind: "label", id: l.id }} name={l.name} dot={l.color} count={m.unread({ kind: "label", id: l.id })} />}
      </For>
    </View>
  );
}
