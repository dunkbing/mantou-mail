// The message list: a row per message, scrolled with the wheel.
import { For, Show, Text, View, createEffect, on, onCleanup, type Node } from "mantou-ui";
import { daysSince, shortDate, type Message } from "../data";
import { usesTabs, type Mail } from "../state";
import { C, hline, small } from "./theme";
import { Avatar, Chip, LabelChips } from "./common";
import { RELATIVE, createScroll, ScrollThumb } from "./scroll";

export const FOLDER_NAMES: Record<string, string> = { archive: "Archive", sent: "Sent", trash: "Trash" };

/** Who a row is about: the sender, or for mail you wrote, who it's to. */
export function rowName(mail: Mail, msg: Message) {
  if (!mail.isMine(msg.from)) return msg.from.name;
  const to = msg.to?.map((c) => c.name).join(", ");
  return to ? `To: ${to}` : msg.folder === "drafts" ? "Draft" : msg.from.name;
}

export function Row(props: { mail: Mail; message: Message; ref: (n: Node) => void }) {
  const msg = () => props.message;
  const selected = () => props.mail.selected()?.id === msg().id;
  const size = () => props.mail.threadSize(msg());
  /** In mixed lists (labels, starred, search), where a message lives. */
  const folder = () => (props.mail.mailbox().kind === "folder" ? undefined : FOLDER_NAMES[msg().folder]);
  return (
    <View
      ref={props.ref}
      style={{ flexDirection: "row", gap: 10, paddingTop: 12, paddingBottom: 12, paddingLeft: 10, paddingRight: 16, backgroundColor: selected() ? C.accentSoft : "#ffffff" }}
      onPress={() => props.mail.select(msg().id)}
    >
      <View style={{ width: 6, height: 6, flexShrink: 0, marginTop: 13, borderRadius: 3, backgroundColor: msg().unread ? C.unread : "transparent" }} />
      <Avatar name={msg().from.name} size={32} />
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: msg().unread ? 700 : 500, color: C.text, maxLines: 1 }}>{rowName(props.mail, msg())}</Text>
          <Show when={size() > 1}>
            <Text style={{ flexShrink: 0, fontSize: 12, color: C.muted }}>{String(size())}</Text>
          </Show>
          <View style={{ flexGrow: 1 }} />
          <Show when={msg().starred}>
            <Text style={{ fontSize: 12, color: C.star }}>★</Text>
          </Show>
          <Text style={small}>{shortDate(msg().date)}</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: msg().unread ? 600 : 400, color: C.text, maxLines: 1 }}>{msg().subject || "(no subject)"}</Text>
        <Text style={{ fontSize: 12, color: C.secondary, maxLines: 1 }}>{msg().body.join(" ").replace(/\s+/g, " ")}</Text>
        <Show when={msg().labels.length > 0 || msg().waitingSince || msg().snoozedUntil || folder() || msg().folder === "drafts"}>
          <View style={{ flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap" }}>
            <Show when={msg().folder === "drafts"}>
              <Chip text="Draft" color="#b91c1c" background="#fef2f2" />
            </Show>
            <Show when={folder()}>
              <Chip text={folder() ?? ""} color={C.secondary} background={C.faint} />
            </Show>
            <Show when={msg().waitingSince}>
              <Chip text={`Waiting for reply · ${daysSince(msg().waitingSince!)}d`} color="#9a3412" background="#fff7ed" />
            </Show>
            <Show when={msg().snoozedUntil}>
              <Chip text={`Snoozed until ${msg().snoozedUntil}`} color="#075985" background="#f0f9ff" />
            </Show>
            <LabelChips message={msg()} />
          </View>
        </Show>
      </View>
    </View>
  );
}

export function EmptyList(props: { mail: Mail }) {
  const m = props.mail;
  const text = () => {
    const box = m.mailbox();
    if (box.kind === "search") return box.query ? [`No messages match “${box.query}”`, "Search looks at senders, subjects and text, in every folder but Trash."] : ["Search your mail", "Type to search · Enter keeps the results · Esc goes back"];
    if (usesTabs(box)) return ["You're all caught up", m.tab() === "important" ? "Nothing left in Important." : "Nothing left in Other."];
    return ["Nothing here", ""];
  };
  return (
    <View style={{ paddingTop: 56, paddingLeft: 32, paddingRight: 32, gap: 6, alignItems: "center" }}>
      <Text style={{ fontSize: 15, fontWeight: 600, color: C.text, textAlign: "center" }}>{text()[0]}</Text>
      <Show when={text()[1]}>
        <Text style={[small, { textAlign: "center", lineHeight: 1.5 }]}>{text()[1]}</Text>
      </Show>
    </View>
  );
}

export function MessageList(props: { mail: Mail }) {
  const m = props.mail;
  const scroll = createScroll();
  const rows = new Map<number, Node>();
  // Keep the selected row in view (scrollIntoView, once dunkbing/mantou#5 has it).
  createEffect(() => {
    const s = m.selected();
    const row = s && rows.get(s.id)?.measure();
    const vp = scroll.viewport()?.measure();
    if (!row || !vp) return;
    const top = row.y - vp.y;
    if (top < 0) scroll.by(top);
    else if (top + row.height > vp.height) scroll.by(top + row.height - vp.height);
  });
  createEffect(on([m.mailbox, m.tab], () => scroll.to(0)));
  createEffect(on(m.list, () => scroll.to(scroll.y())));
  return (
    <View ref={scroll.viewportRef} style={{ ...RELATIVE, width: 400, flexShrink: 0, overflow: "hidden", backgroundColor: "#ffffff" }} onWheel={(e) => scroll.by(e.dy)}>
      <View ref={scroll.contentRef} style={{ marginTop: -scroll.y() }}>
        <For each={m.list()} fallback={<EmptyList mail={m} />}>
          {(msg) => {
            let node: Node | undefined;
            onCleanup(() => rows.get(msg.id) === node && rows.delete(msg.id));
            return (
              <>
                <Row mail={m} message={msg} ref={(n) => rows.set(msg.id, (node = n))} />
                <View style={[hline, { marginLeft: 58, backgroundColor: C.faint }]} />
              </>
            );
          }}
        </For>
      </View>
      <ScrollThumb scroll={scroll} />
    </View>
  );
}
