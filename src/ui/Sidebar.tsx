// The sidebar: Compose, search, mailboxes and labels.
import { For, Input, Show, Text, View, type Node } from "mantou-ui";
import { LABELS } from "../data";
import { sameMailbox, type Mail, type Mailbox } from "../state";
import { C, caption } from "./theme";
import { Kbd, dialogFocus } from "./common";
import { STATE_COLOR } from "./Accounts";
import type { Remote } from "../mail/remote";

export function SidebarItem(props: { mail: Mail; mailbox: Mailbox; name: string; count?: number; dot?: string; indent?: boolean }) {
  const active = () => sameMailbox(props.mail.mailbox(), props.mailbox);
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 30, paddingLeft: props.indent ? 22 : 10, paddingRight: 10, borderRadius: 6, backgroundColor: active() ? C.accentSoft : "transparent" }}
      onPress={() => props.mail.open(props.mailbox)}
    >
      <Show when={props.dot}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.dot ?? "transparent" }} />
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
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, flexShrink: 0, marginBottom: 12, paddingLeft: 4, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: m.searching() ? C.accent : C.line, backgroundColor: "#ffffff" }}
      onPress={() => input?.focus()}
    >
      <Input
        ref={(n) => props.ref((input = n))}
        value={m.query()}
        placeholder="Search mail"
        onChange={m.setQuery}
        onFocus={() => {
          // Workaround for dunkbing/mantou#6: Tab leaves a dialog for this field, behind it.
          const back = dialogFocus();
          if (back) return void (input?.blur(), back());
          m.startSearch();
        }}
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
    <View style={{ width: 228, flexShrink: 0, paddingTop: 18, paddingLeft: 12, paddingRight: 12, gap: 2, backgroundColor: C.sidebar }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingBottom: 14 }}>
        <View style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, backgroundColor: C.accent, justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontWeight: 700, fontSize: 14, textAlign: "center" }}>M</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Mantou Mail</Text>
      </View>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 34, flexShrink: 0, marginBottom: 10, borderRadius: 7, backgroundColor: C.accent }}
        onPress={() => m.compose()}
      >
        <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>Compose</Text>
        <Text style={{ fontSize: 11, fontWeight: 600, color: "#c7d2fe" }}>C</Text>
      </View>
      <SearchField mail={m} ref={props.searchRef} />
      <SidebarItem mail={m} mailbox={{ kind: "all" }} name="All inboxes" count={m.unread({ kind: "all" })} />
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 28, paddingLeft: 22, paddingRight: 10, borderRadius: 6 }} onPress={props.onAccounts}>
          <Text style={{ flexShrink: 1, fontSize: 12, fontWeight: 500, color: m.accounts()[0]?.sample ? C.accent : C.muted, maxLines: 1 }}>{m.accounts()[0]?.sample ? "Add your account" : "Manage accounts"}</Text>
          <Show when={m.accounts()[0]?.sample}>
            <Text style={{ flexShrink: 0, fontSize: 11, color: C.muted }}>sample mail</Text>
          </Show>
        </View>
      </Show>
      <View style={{ height: 10 }} />
      <SidebarItem mail={m} mailbox={{ kind: "starred" }} name="Starred" count={m.count({ kind: "starred" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "snoozed" }} name="Snoozed" count={m.count({ kind: "folder", folder: "snoozed" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "drafts" }} name="Drafts" count={m.count({ kind: "folder", folder: "drafts" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "sent" }} name="Sent" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "archive" }} name="Archive" />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "trash" }} name="Trash" count={m.count({ kind: "folder", folder: "trash" })} />
      <View style={{ height: 16 }} />
      <Text style={[caption, { paddingLeft: 10, paddingBottom: 6 }]}>LABELS</Text>
      <For each={LABELS}>
        {(l) => <SidebarItem mail={m} mailbox={{ kind: "label", id: l.id }} name={l.name} dot={l.color} count={m.unread({ kind: "label", id: l.id })} />}
      </For>
    </View>
  );
}
