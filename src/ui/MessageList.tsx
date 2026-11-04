// The message list: a row per message, scrolled with the wheel.
import { For, Scroll, Show, Text, View, createEffect, createMemo, createSignal, on, onCleanup, type Node } from "mantou-ui";
import { daysSince, shortDate, type Message } from "../data";
import { usesTabs, type Mail } from "../state";
import { C, hline, small } from "./theme";
import { Avatar, Chip, LabelChips } from "./common";
import { Icon, type IconName } from "./icons";
import type { Remote } from "../mail/remote";

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
        <Show when={msg().labels.length > 0 || msg().waitingSince || msg().snoozedUntil || folder() || msg().folder === "drafts" || msg().outbox}>
          <View style={{ flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap" }}>
            <Show when={msg().folder === "drafts"}>
              <Chip text="Draft" color="#b91c1c" background="#fef2f2" />
            </Show>
            <Show when={msg().outbox}>
              <Chip text="Sending…" color="#92400e" background="#fef3c7" />
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
  const icon = (): IconName => {
    const box = m.mailbox();
    if (box.kind === "search") return "search";
    if (box.kind === "folder") return ({ snoozed: "clock", drafts: "doc", sent: "sent", archive: "archive", trash: "trash" } as const)[box.folder];
    if (box.kind === "starred") return "starOutline";
    if (box.kind === "label") return "tag";
    return "check";
  };
  return (
    <View style={{ paddingTop: 56, paddingLeft: 32, paddingRight: 32, gap: 6, alignItems: "center" }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, marginBottom: 10, backgroundColor: C.faint, justifyContent: "center", alignItems: "center" }}>
        <Icon name={icon()} size={30} color={C.muted} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: 600, color: C.text, textAlign: "center" }}>{text()[0]}</Text>
      <Show when={text()[1]}>
        <Text style={[small, { textAlign: "center", lineHeight: 1.5 }]}>{text()[1]}</Text>
      </Show>
    </View>
  );
}

/**
 * Rows are rendered a page at a time, more as the scroll nears the end of
 * what's rendered (and always as far as the selection). Workaround for
 * dunkbing/mantou#19 (a virtualized List): rendering every row of a big
 * mailbox costs about 8 nodes and 53 ops a row.
 */
export const PAGE = 60;

/** At the end of a real folder's list: what the server has beyond what's kept. */
function LoadOlder(props: { mail: Mail; remote: Remote }) {
  const [loading, setLoading] = createSignal(false);
  const n = () => props.remote.olderCount(props.mail.mailbox());
  const load = async () => {
    if (loading()) return;
    setLoading(true);
    try {
      await props.remote.loadOlder(props.mail.mailbox());
    } finally {
      setLoading(false);
    }
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52 }} onPress={() => void load()}>
      <Icon name="archive" size={14} color={loading() ? C.muted : C.accent} />
      <Text style={{ fontSize: 13, fontWeight: 500, color: loading() ? C.muted : C.accent }}>{loading() ? "Getting older mail…" : "Load older messages"}</Text>
      <Text style={small}>{`${n().toLocaleString("en-GB")} more on the server`}</Text>
    </View>
  );
}

export function MessageList(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  let list: Node | undefined;
  const rows = new Map<number, Node>();
  const [limit, setLimit] = createSignal(PAGE);
  // The scroll's offset and sizes as the core last reported them.
  const at = { offset: 0, viewport: 0, content: 0 };
  const shown = createMemo(() => {
    const all = m.list(), s = m.selected();
    const at = s ? all.indexOf(s) : -1;
    return all.slice(0, Math.max(limit(), at + 1 + PAGE / 4));
  });
  /** Within two screens of the end of what's rendered: render another page. Checked when the core reports a scroll or a new size, so the sizes are current. */
  const more = () => {
    if (at.content > 0 && shown().length < m.list().length && at.offset + 2 * at.viewport >= at.content) setLimit(shown().length + PAGE);
  };
  createEffect(on([m.mailbox, m.tab], () => {
    setLimit(PAGE);
    at.offset = 0;
    list?.scrollTo({ y: 0 });
  }));
  // Keep the selected row in view.
  createEffect(() => {
    const s = m.selected();
    const row = s && rows.get(s.id);
    if (row && !row.released) row.scrollIntoView({ block: "nearest" });
  });
  return (
    <Scroll ref={(n) => (list = n)} style={{ width: 400, flexShrink: 0, backgroundColor: "#ffffff" }} onScroll={(o) => ((at.offset = o.y), more())} onLayout={(r) => ((at.viewport = r.height), more())}>
      <View onLayout={(r) => ((at.content = r.height), more())}>
        <For each={shown()} fallback={<EmptyList mail={m} />}>
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
        <Show when={props.remote && shown().length === m.list().length && props.remote.olderCount(m.mailbox()) > 0}>
          <LoadOlder mail={m} remote={props.remote!} />
        </Show>
      </View>
    </Scroll>
  );
}
