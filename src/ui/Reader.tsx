// The reader: the selected message's conversation, and the panel under it
// (reply, snooze, labels).
import { For, Show, Text, View, createEffect, createSignal, on, Scroll, type Node } from "mantou-ui";
import { LABELS, daysSince, longDate, shortDate, type Attachment, type Message } from "../data";
import { homedir } from "node:os";
import type { Remote } from "../mail/remote";
import { SNOOZE_OPTIONS, type Mail } from "../state";
import { C, hline, caption, small } from "./theme";
import { Avatar, Chip, LabelChips, Kbd, AttachmentChip } from "./common";
import { ReplyComposer } from "./Compose";

export function displayName(mail: Mail, msg: Message) {
  return mail.isMine(msg.from) ? "Me" : msg.from.name;
}

/** One message of the conversation, open. */
export function OpenMessage(props: { mail: Mail; remote?: Remote; message: Message; onPress?: () => void }) {
  const msg = () => props.message;
  const open = (a: Attachment) => {
    if (!props.remote) return props.mail.note("Attachments open in the app, with its data folder");
    props.mail.note(`Opening “${a.name}”…`);
    props.remote.openAttachment(msg(), a).then(
      (path) => props.mail.note(`Saved “${a.name}” to ${path.replace(homedir(), "~")}`),
      (e: Error) => props.mail.note(`Couldn't open “${a.name}”: ${e.message}`),
    );
  };
  const to = () => props.mail.accountOf(msg().account)?.email ?? "";
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={props.onPress}>
        <Avatar name={msg().from.name} size={40} />
        <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: C.text, maxLines: 1 }}>{displayName(props.mail, msg())}</Text>
          <Text style={[small, { maxLines: 1 }]}>{`${msg().from.email} → ${props.mail.isMine(msg().from) ? (msg().to?.map((c) => c.email).join(", ") || "no recipients yet") : to()}`}</Text>
        </View>
        <Text style={small}>{longDate(msg().date)}</Text>
      </View>
      <View style={{ gap: 14 }}>
        <For each={msg().body}>{(p) => <Text style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937" }}>{p}</Text>}</For>
      </View>
      <Show when={msg().attachments?.length}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <For each={msg().attachments}>{(a) => <AttachmentChip attachment={a} onPress={() => open(a)} />}</For>
        </View>
      </Show>
    </View>
  );
}

/** One message of the conversation, folded to a line; pressing opens it. */
export function FoldedMessage(props: { mail: Mail; message: Message; onPress: () => void }) {
  const msg = () => props.message;
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={props.onPress}>
      <Avatar name={msg().from.name} size={32} />
      <Text style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: C.text, maxLines: 1 }}>{displayName(props.mail, msg())}</Text>
      <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, color: C.secondary, maxLines: 1 }}>{msg().body.join(" ").replace(/\s+/g, " ")}</Text>
      <Text style={[small, { flexShrink: 0 }]}>{shortDate(msg().date)}</Text>
    </View>
  );
}

export function Panel(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  const s = () => m.selected()!;
  const option = (key: string, text: string, onPress: () => void, active = false, dot?: string) => (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 16, borderWidth: 1, borderColor: active ? (dot ?? C.accent) : C.line, backgroundColor: active ? `${dot ?? C.accent}14` : "#ffffff" }}
      onPress={onPress}
    >
      <Text style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{key}</Text>
      <Show when={dot}>
        <View style={{ width: 12, height: 12, borderRadius: 3, borderWidth: 1.5, borderColor: dot ?? C.line, backgroundColor: active ? (dot ?? C.accent) : "transparent" }} />
      </Show>
      <Text style={{ fontSize: 13, color: C.text }}>{text}</Text>
    </View>
  );
  return (
    <>
      <View style={hline} />
      <View style={{ paddingTop: 14, paddingBottom: 16, paddingLeft: 36, paddingRight: 36, gap: 10, backgroundColor: "#fafafa" }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[caption, { flexGrow: 1, flexShrink: 1, maxLines: 1 }]}>
            {m.panel() === "reply" ? `REPLY TO ${m.draft().to.replace(/\s*<.*$/, "").toUpperCase()}` : m.panel() === "snooze" ? "SNOOZE UNTIL" : "LABELS"}
          </Text>
          <Text style={[caption, { fontWeight: 500 }]}>{m.panel() === "reply" ? "Esc keeps a draft" : "Esc to close"}</Text>
        </View>
        <Show when={m.panel() === "reply"}>
          <ReplyComposer mail={m} remote={props.remote} />
        </Show>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Show when={m.panel() === "snooze"}>
            <For each={SNOOZE_OPTIONS}>{(o, i) => option(String(i() + 1), `${o.name} · ${o.time}`, () => m.snooze(i()))}</For>
          </Show>
          <Show when={m.panel() === "labels"}>
            <For each={LABELS}>{(l, i) => option(String(i() + 1), l.name, () => m.toggleLabel(l.id), s().labels.includes(l.id), l.color)}</For>
          </Show>
        </View>
      </View>
    </>
  );
}

export function Reader(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  let scroll: Node | undefined;
  /** Messages of the conversation opened by pressing them (the selected one is always open). */
  const [opened, setOpened] = createSignal<ReadonlySet<number>>(new Set());
  const isOpen = (msg: Message) => msg.id === m.selected()?.id || opened().has(msg.id);
  const toggle = (id: number) => {
    const next = new Set(opened());
    next.has(id) ? next.delete(id) : next.add(id);
    setOpened(next);
  };
  createEffect(on(() => m.selected()?.id, () => {
    setOpened(new Set<number>());
    if (scroll && !scroll.released) scroll.scrollTo({ y: 0 }); // the <Show> releases it while nothing is selected
  }));
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, backgroundColor: "#ffffff" }}>
      <Show when={m.selected()} fallback={<Text style={[small, { padding: 48, textAlign: "center" }]}>No message selected</Text>}>
        <Scroll ref={(n) => (scroll = n)} style={{ flexGrow: 1, minHeight: 0 }}>
          <View style={{ paddingTop: 28, paddingLeft: 36, paddingRight: 36, paddingBottom: 28, gap: 18 }}>
            <Text style={{ fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{m.selected()!.subject || "(no subject)"}</Text>
            <Show when={m.selected()!.folder === "drafts"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Chip text="Draft" color="#b91c1c" background="#fef2f2" />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingLeft: 10, paddingRight: 8, borderRadius: 6, borderWidth: 1, borderColor: C.line }} onPress={() => m.compose(m.selected()!)}>
                  <Text style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Edit draft</Text>
                  <Kbd text="Enter" />
                </View>
              </View>
            </Show>
            <Show when={m.selected()!.labels.length > 0 || m.selected()!.waitingSince || m.conversation().length > 1}>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Show when={m.conversation().length > 1}>
                  <Chip text={`${m.conversation().length} messages`} color={C.secondary} background={C.faint} />
                </Show>
                <Show when={m.selected()!.waitingSince}>
                  <Chip text={`Waiting for reply · ${daysSince(m.selected()!.waitingSince!)}d`} color="#9a3412" background="#fff7ed" />
                </Show>
                <LabelChips message={m.selected()!} />
              </View>
            </Show>
            <For each={m.conversation()}>
              {(msg) => (
                <>
                  <View style={hline} />
                  <Show when={isOpen(msg)} fallback={<FoldedMessage mail={m} message={msg} onPress={() => toggle(msg.id)} />}>
                    <OpenMessage mail={m} remote={props.remote} message={msg} onPress={msg.id === m.selected()?.id ? undefined : () => toggle(msg.id)} />
                  </Show>
                </>
              )}
            </For>
          </View>
        </Scroll>
        <Show when={m.panel()}>
          <Panel mail={m} remote={props.remote} />
        </Show>
      </Show>
    </View>
  );
}
