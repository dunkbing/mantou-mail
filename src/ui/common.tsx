// Small pieces used all over: avatars, chips, key hints, buttons.
import { For, Show, Text, View } from "mantou-ui";
import { Icon } from "./icons";
import { LABELS, type Attachment, type Message } from "../data";
import { SEND_KEYS, C, AVATAR_COLORS } from "./theme";

export function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
export function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar(props: { name: string; size: number }) {
  return (
    <View style={{ width: props.size, height: props.size, flexShrink: 0, borderRadius: props.size / 2, backgroundColor: avatarColor(props.name), justifyContent: "center" }}>
      <Text style={{ color: "#ffffff", fontSize: props.size * 0.38, fontWeight: 600, textAlign: "center" }}>{initials(props.name)}</Text>
    </View>
  );
}

export function Chip(props: { text: string; color: string; background: string }) {
  return (
    <View style={{ height: 20, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 10, backgroundColor: props.background, justifyContent: "center" }}>
      <Text style={{ fontSize: 11, fontWeight: 500, color: props.color, maxLines: 1 }}>{props.text}</Text>
    </View>
  );
}

export function LabelChips(props: { message: Message }) {
  return (
    <For each={props.message.labels}>
      {(id) => {
        const l = LABELS.find((x) => x.id === id)!;
        return <Chip text={l.name} color={l.color} background={`${l.color}1f`} />;
      }}
    </For>
  );
}

export function Kbd(props: { text: string }) {
  return (
    <View style={{ height: 18, minWidth: 18, flexShrink: 0, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderColor: C.line, backgroundColor: C.faint, justifyContent: "center" }}>
      <Text style={{ fontSize: 10, fontWeight: 600, color: C.secondary, textAlign: "center" }}>{props.text}</Text>
    </View>
  );
}

export function SendButton(props: { onPress: () => void; label?: string; keys?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 32, flexShrink: 0, paddingLeft: 14, paddingRight: 12, borderRadius: 7, backgroundColor: C.accent }} onPress={props.onPress}>
      <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{props.label ?? "Send"}</Text>
      <Text style={{ fontSize: 11, fontWeight: 600, color: "#c7d2fe" }}>{props.keys ?? SEND_KEYS}</Text>
    </View>
  );
}

export function TextButton(props: { label: string; onPress: () => void }) {
  return (
    <View style={{ height: 32, flexShrink: 0, paddingLeft: 10, paddingRight: 10, justifyContent: "center", borderRadius: 7 }} onPress={props.onPress}>
      <Text style={{ fontSize: 13, fontWeight: 500, color: C.secondary }}>{props.label}</Text>
    </View>
  );
}

/** 1.2 MB, 340 KB, 12 B. */
export function humanSize(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** An attachment: its name and size; pressing opens it, × (when given) takes it off a draft. */
export function AttachmentChip(props: { attachment: Attachment; onPress?: () => void; onRemove?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 40, flexShrink: 1, paddingLeft: 10, paddingRight: 10, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff" }} onPress={props.onPress}>
      <Icon name="paperclip" size={14} color={C.secondary} />
      <View style={{ flexShrink: 1, gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: 500, color: C.text, maxLines: 1, maxWidth: 240 }}>{props.attachment.name}</Text>
        <Text style={{ fontSize: 11, color: C.muted }}>{humanSize(props.attachment.size)}</Text>
      </View>
      <Show when={props.onRemove}>
        <View style={{ width: 20, height: 20, borderRadius: 10, justifyContent: "center", alignItems: "center" }} onPress={(e) => (e.stopPropagation(), props.onRemove!())}>
          <Icon name="close" size={14} color={C.muted} />
        </View>
      </Show>
    </View>
  );
}
