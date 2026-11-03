// The toolbar over the list and reader: tabs or the mailbox's name, and actions.
import { Show, Text, View } from "mantou-ui";
import { isFiledAway, usesTabs, type Mail, type Tab } from "../state";
import { C } from "./theme";
import { Chip } from "./common";
import { Icon, type IconName } from "./icons";

export function ToolButton(props: { label: string; icon: IconName; hint: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6, height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 6, borderWidth: 1, borderColor: props.active ? C.accent : C.line, backgroundColor: props.active ? C.accentSoft : "#ffffff", opacity: props.disabled ? 0.45 : 1 }}
      onPress={() => !props.disabled && props.onPress()}
    >
      <Icon name={props.icon} size={15} color={props.active ? C.accent : C.secondary} />
      <Text style={{ fontSize: 13, fontWeight: 500, color: props.active ? C.accent : C.text }}>{props.label}</Text>
      <Text style={{ fontSize: 11, color: C.muted }}>{props.hint}</Text>
    </View>
  );
}

export function TabButton(props: { mail: Mail; tab: Tab; name: string }) {
  const active = () => props.mail.tab() === props.tab;
  return (
    <View style={{ height: 52, justifyContent: "center" }} onPress={() => props.mail.setTab(props.tab)}>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingLeft: 4, paddingRight: 4, flexGrow: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: active() ? 600 : 500, color: active() ? C.text : C.muted }}>{props.name}</Text>
        <Show when={props.mail.unreadInTab(props.tab) > 0}>
          <Chip text={String(props.mail.unreadInTab(props.tab))} color={active() ? "#ffffff" : C.secondary} background={active() ? C.accent : C.faint} />
        </Show>
      </View>
      <View style={{ height: 2, backgroundColor: active() ? C.accent : "transparent" }} />
    </View>
  );
}

export function Toolbar(props: { mail: Mail }) {
  const m = props.mail;
  const none = () => !m.selected();
  const filed = () => !!m.selected() && isFiledAway(m.selected()!);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 52, flexShrink: 0, paddingLeft: 20, paddingRight: 16, gap: 18 }}>
      <Show when={usesTabs(m.mailbox())} fallback={<Text style={{ flexShrink: 1, fontSize: 15, fontWeight: 600, color: C.text, maxLines: 1 }}>{m.mailboxName(m.mailbox())}</Text>}>
        <TabButton mail={m} tab="important" name="Important" />
        <TabButton mail={m} tab="other" name="Other" />
      </Show>
      <View style={{ flexGrow: 1 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Show
          when={filed()}
          fallback={
            <>
              <ToolButton label="Archive" icon="archive" hint="E" onPress={m.archive} disabled={none()} />
              <ToolButton label="Snooze" icon="clock" hint="H" onPress={() => m.togglePanel("snooze")} disabled={none()} active={m.panel() === "snooze"} />
            </>
          }
        >
          <ToolButton label="Move to Inbox" icon="inbox" hint="I" onPress={m.moveToInbox} />
        </Show>
        <ToolButton label="Label" icon="tag" hint="L" onPress={() => m.togglePanel("labels")} disabled={none()} active={m.panel() === "labels"} />
        <ToolButton label="Reply" icon="reply" hint="R" onPress={m.toggleReply} disabled={none()} active={m.panel() === "reply"} />
        <ToolButton label={m.selected()?.folder === "trash" ? "Delete forever" : "Delete"} icon="trash" hint="#" onPress={m.remove} disabled={none()} />
      </View>
    </View>
  );
}
