// Mantou Mail: a sidebar of mailboxes and labels, a message list, a reader
// that shows the whole conversation, and keyboard triage (? lists the keys).
import { For, Show, Text, View, createEffect, createSignal, defineStyle, on, onCleanup, onKey, useUi, type Node } from "mantou-ui";
import { ACCOUNTS, LABELS, ME, daysSince, longDate, shortDate, type Message } from "./data";
import { QUICK_REPLIES, SNOOZE_OPTIONS, createMail, isFiledAway, mailboxName, sameMailbox, usesTabs, type Mail, type Mailbox, type Tab } from "./state";

// ---------------------------------------------------------------- theme
const C = {
  text: "#111827",
  secondary: "#4b5563",
  muted: "#9ca3af",
  line: "#e5e7eb",
  faint: "#f3f4f6",
  sidebar: "#f7f7f9",
  accent: "#4f46e5",
  accentSoft: "#eef2ff",
  unread: "#3b82f6",
  star: "#f59e0b",
  backdrop: "#11182759",
};
const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const hline = defineStyle({ height: 1, flexShrink: 0, backgroundColor: C.line });
const vline = defineStyle({ width: 1, flexShrink: 0, backgroundColor: C.line });
const caption = defineStyle({ fontSize: 11, fontWeight: 600, color: C.muted });
const small = defineStyle({ fontSize: 12, color: C.muted });

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar(props: { name: string; size: number }) {
  return (
    <View style={{ width: props.size, height: props.size, flexShrink: 0, borderRadius: props.size / 2, backgroundColor: avatarColor(props.name), justifyContent: "center" }}>
      <Text style={{ color: "#ffffff", fontSize: props.size * 0.38, fontWeight: 600, textAlign: "center" }}>{initials(props.name)}</Text>
    </View>
  );
}

function Chip(props: { text: string; color: string; background: string }) {
  return (
    <View style={{ height: 20, flexShrink: 0, paddingLeft: 8, paddingRight: 8, borderRadius: 10, backgroundColor: props.background, justifyContent: "center" }}>
      <Text style={{ fontSize: 11, fontWeight: 500, color: props.color, maxLines: 1 }}>{props.text}</Text>
    </View>
  );
}

function LabelChips(props: { message: Message }) {
  return (
    <For each={props.message.labels}>
      {(id) => {
        const l = LABELS.find((x) => x.id === id)!;
        return <Chip text={l.name} color={l.color} background={`${l.color}1f`} />;
      }}
    </For>
  );
}

// ---------------------------------------------------------------- scrolling
// Mantou doesn't scroll in the core yet, so a scroll area is a clipping
// viewport whose content moves up by a negative margin as the wheel turns.
function createScroll() {
  const [y, setY] = createSignal(0);
  const [extent, setExtent] = createSignal({ content: 0, viewport: 0 });
  let viewport: Node | undefined;
  let content: Node | undefined;
  /**
   * Measures the content and the viewport again. Called after anything that
   * changes them that the app knows about. Workaround for dunkbing/mantou#3:
   * apps aren't told when the window resizes, so after a resize the extent is
   * stale until the next wheel or change.
   */
  const height = (n: Node | undefined) => (n && !n.released ? (n.measure()?.height ?? 0) : 0); // a <Show> may have released them
  const measure = () => {
    const e = { content: height(content), viewport: height(viewport) };
    const prev = extent();
    if (prev.content !== e.content || prev.viewport !== e.viewport) setExtent(e);
    return e;
  };
  const to = (v: number) => {
    const e = measure();
    setY(Math.max(0, Math.min(Math.max(0, e.content - e.viewport), v)));
  };
  return {
    y, extent, measure, to,
    by: (d: number) => to(y() + d),
    viewportRef: (n: Node) => (viewport = n),
    contentRef: (n: Node) => (content = n),
    viewport: () => (viewport?.released ? undefined : viewport),
  };
}
type Scroll = ReturnType<typeof createScroll>;
const RELATIVE = { position: "relative" } as const;

/**
 * A thin scrollbar thumb, while the content is taller than its viewport. The
 * viewport needs `position: "relative"` (RELATIVE below). Workaround: Mantou
 * documents relative as the default, but its core leaves Taffy's default
 * (static), so `right`/`bottom` resolve against the window without it.
 * Workaround for dunkbing/mantou#1.
 */
function ScrollThumb(props: { scroll: Scroll }) {
  const thumb = () => {
    const { content, viewport } = props.scroll.extent();
    if (viewport <= 0 || content <= viewport + 1) return null;
    const height = Math.max(28, (viewport * viewport) / content);
    return { height, top: ((viewport - height) * props.scroll.y()) / (content - viewport) };
  };
  return (
    <Show when={thumb()}>
      <View style={{ position: "absolute", right: 3, top: thumb()?.top ?? 0, width: 5, height: thumb()?.height ?? 0, borderRadius: 2.5, backgroundColor: "#0000002a" }} />
    </Show>
  );
}

// ---------------------------------------------------------------- sidebar
function SidebarItem(props: { mail: Mail; mailbox: Mailbox; name: string; count?: number; dot?: string; indent?: boolean }) {
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
 * The search field. Workaround: the pinned mantou-ui has no text input, so
 * the query is typed through onKey and drawn as text with a caret: no
 * selection, no cursor movement, no IME, no paste. Mantou has <Input> since
 * 92ed187; move to it when updating mantou-ui (docs/upstream.md, "Text input").
 */
function SearchField(props: { mail: Mail }) {
  const m = props.mail;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 32, flexShrink: 0, marginBottom: 12, paddingLeft: 10, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: m.searching() ? C.accent : C.line, backgroundColor: "#ffffff" }}
      onPress={m.startSearch}
    >
      <Show when={m.query()}>
        <Text style={{ flexShrink: 1, fontSize: 13, color: C.text, maxLines: 1 }}>{m.query()}</Text>
      </Show>
      <Show when={m.searching()}>
        <View style={{ width: 1.5, height: 16, flexShrink: 0, backgroundColor: C.accent }} />
      </Show>
      <Show when={!m.query()}>
        <Text style={{ flexShrink: 1, fontSize: 13, color: C.muted, maxLines: 1, paddingLeft: m.searching() ? 2 : 0 }}>Search mail</Text>
      </Show>
      <View style={{ flexGrow: 1 }} />
      <Kbd text={m.searching() ? "Esc" : "/"} />
    </View>
  );
}

function Kbd(props: { text: string }) {
  return (
    <View style={{ height: 18, minWidth: 18, flexShrink: 0, paddingLeft: 5, paddingRight: 5, borderRadius: 4, borderWidth: 1, borderColor: C.line, backgroundColor: C.faint, justifyContent: "center" }}>
      <Text style={{ fontSize: 10, fontWeight: 600, color: C.secondary, textAlign: "center" }}>{props.text}</Text>
    </View>
  );
}

function Sidebar(props: { mail: Mail }) {
  const m = props.mail;
  return (
    <View style={{ width: 228, flexShrink: 0, paddingTop: 18, paddingLeft: 12, paddingRight: 12, gap: 2, backgroundColor: C.sidebar }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingBottom: 14 }}>
        <View style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, backgroundColor: C.accent, justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontWeight: 700, fontSize: 14, textAlign: "center" }}>M</Text>
        </View>
        <Text style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Mantou Mail</Text>
      </View>
      <SearchField mail={m} />
      <SidebarItem mail={m} mailbox={{ kind: "all" }} name="All inboxes" count={m.unread({ kind: "all" })} />
      <For each={ACCOUNTS}>
        {(a) => <SidebarItem mail={m} mailbox={{ kind: "account", id: a.id }} name={a.name} count={m.unread({ kind: "account", id: a.id })} indent />}
      </For>
      <View style={{ height: 10 }} />
      <SidebarItem mail={m} mailbox={{ kind: "starred" }} name="Starred" count={m.count({ kind: "starred" })} />
      <SidebarItem mail={m} mailbox={{ kind: "folder", folder: "snoozed" }} name="Snoozed" count={m.count({ kind: "folder", folder: "snoozed" })} />
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

// ---------------------------------------------------------------- toolbar
function ToolButton(props: { label: string; hint: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6, height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 6, borderWidth: 1, borderColor: props.active ? C.accent : C.line, backgroundColor: props.active ? C.accentSoft : "#ffffff", opacity: props.disabled ? 0.45 : 1 }}
      onPress={() => !props.disabled && props.onPress()}
    >
      <Text style={{ fontSize: 13, fontWeight: 500, color: props.active ? C.accent : C.text }}>{props.label}</Text>
      <Text style={{ fontSize: 11, color: C.muted }}>{props.hint}</Text>
    </View>
  );
}

function TabButton(props: { mail: Mail; tab: Tab; name: string }) {
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

function Toolbar(props: { mail: Mail }) {
  const m = props.mail;
  const none = () => !m.selected();
  const filed = () => !!m.selected() && isFiledAway(m.selected()!);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 52, flexShrink: 0, paddingLeft: 20, paddingRight: 16, gap: 18 }}>
      <Show when={usesTabs(m.mailbox())} fallback={<Text style={{ flexShrink: 1, fontSize: 15, fontWeight: 600, color: C.text, maxLines: 1 }}>{mailboxName(m.mailbox())}</Text>}>
        <TabButton mail={m} tab="important" name="Important" />
        <TabButton mail={m} tab="other" name="Other" />
      </Show>
      <View style={{ flexGrow: 1 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Show
          when={filed()}
          fallback={
            <>
              <ToolButton label="Archive" hint="E" onPress={m.archive} disabled={none()} />
              <ToolButton label="Snooze" hint="H" onPress={() => m.togglePanel("snooze")} disabled={none()} active={m.panel() === "snooze"} />
            </>
          }
        >
          <ToolButton label="Move to Inbox" hint="I" onPress={m.moveToInbox} />
        </Show>
        <ToolButton label="Label" hint="L" onPress={() => m.togglePanel("labels")} disabled={none()} active={m.panel() === "labels"} />
        <ToolButton label="Reply" hint="R" onPress={m.toggleReply} disabled={none()} active={m.panel() === "reply"} />
        <ToolButton label={m.selected()?.folder === "trash" ? "Delete forever" : "Delete"} hint="#" onPress={m.remove} disabled={none()} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- list
const FOLDER_NAMES: Record<string, string> = { archive: "Archive", sent: "Sent", trash: "Trash" };

function Row(props: { mail: Mail; message: Message; ref: (n: Node) => void }) {
  const msg = () => props.message;
  const selected = () => props.mail.selected()?.id === msg().id;
  const size = () => props.mail.threadSize(msg());
  /** In mixed lists (labels, starred, search), where a message lives. */
  const folder = () => (props.mail.mailbox().kind === "folder" ? undefined : FOLDER_NAMES[msg().folder]);
  return (
    <View
      ref={props.ref}
      style={{ flexDirection: "row", gap: 10, paddingTop: 12, paddingBottom: 12, paddingLeft: 10, paddingRight: 16, backgroundColor: selected() ? C.accentSoft : "#ffffff" }}
      onPress={() => {
        if (props.mail.searching()) props.mail.submitSearch(); // keys go back to triage
        props.mail.select(msg().id);
      }}
    >
      <View style={{ width: 6, height: 6, flexShrink: 0, marginTop: 13, borderRadius: 3, backgroundColor: msg().unread ? C.unread : "transparent" }} />
      <Avatar name={msg().from.name} size={32} />
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: msg().unread ? 700 : 500, color: C.text, maxLines: 1 }}>{msg().from.name}</Text>
          <Show when={size() > 1}>
            <Text style={{ flexShrink: 0, fontSize: 12, color: C.muted }}>{String(size())}</Text>
          </Show>
          <View style={{ flexGrow: 1 }} />
          <Show when={msg().starred}>
            <Text style={{ fontSize: 12, color: C.star }}>★</Text>
          </Show>
          <Text style={small}>{shortDate(msg().date)}</Text>
        </View>
        <Text style={{ fontSize: 13, fontWeight: msg().unread ? 600 : 400, color: C.text, maxLines: 1 }}>{msg().subject}</Text>
        <Text style={{ fontSize: 12, color: C.secondary, maxLines: 1 }}>{msg().body.join(" ").replace(/\s+/g, " ")}</Text>
        <Show when={msg().labels.length > 0 || msg().waitingSince || msg().snoozedUntil || folder()}>
          <View style={{ flexDirection: "row", gap: 6, paddingTop: 4, flexWrap: "wrap" }}>
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

function EmptyList(props: { mail: Mail }) {
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

function MessageList(props: { mail: Mail }) {
  const m = props.mail;
  const scroll = createScroll();
  const rows = new Map<number, Node>();
  // Keep the selected row in view.
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

// ---------------------------------------------------------------- reader
function displayName(name: string) {
  return name === ME ? "Me" : name;
}

/** One message of the conversation, open. */
function OpenMessage(props: { message: Message; onPress?: () => void }) {
  const msg = () => props.message;
  const to = () => ACCOUNTS.find((a) => a.id === msg().account)!.email;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={props.onPress}>
        <Avatar name={msg().from.name} size={40} />
        <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: C.text, maxLines: 1 }}>{displayName(msg().from.name)}</Text>
          <Text style={[small, { maxLines: 1 }]}>{msg().from.name === ME ? msg().from.email : `${msg().from.email} → ${to()}`}</Text>
        </View>
        <Text style={small}>{longDate(msg().date)}</Text>
      </View>
      <View style={{ gap: 14 }}>
        <For each={msg().body}>{(p) => <Text style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937" }}>{p}</Text>}</For>
      </View>
    </View>
  );
}

/** One message of the conversation, folded to a line; pressing opens it. */
function FoldedMessage(props: { message: Message; onPress: () => void }) {
  const msg = () => props.message;
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={props.onPress}>
      <Avatar name={msg().from.name} size={32} />
      <Text style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: C.text, maxLines: 1 }}>{displayName(msg().from.name)}</Text>
      <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, color: C.secondary, maxLines: 1 }}>{msg().body.join(" ").replace(/\s+/g, " ")}</Text>
      <Text style={[small, { flexShrink: 0 }]}>{shortDate(msg().date)}</Text>
    </View>
  );
}

function Panel(props: { mail: Mail }) {
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
            {m.panel() === "reply" ? `QUICK REPLY TO ${s().from.name.toUpperCase()}` : m.panel() === "snooze" ? "SNOOZE UNTIL" : "LABELS"}
          </Text>
          <Text style={[caption, { fontWeight: 500 }]}>Esc to close</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Show when={m.panel() === "reply"}>
            <For each={QUICK_REPLIES}>{(text, i) => option(String(i() + 1), text, () => m.reply(text))}</For>
          </Show>
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

function Reader(props: { mail: Mail }) {
  const m = props.mail;
  const scroll = createScroll();
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
    scroll.to(0);
  }));
  createEffect(on([m.conversation, opened, m.panel], () => scroll.to(scroll.y())));
  return (
    <View style={{ flexGrow: 1, flexShrink: 1, backgroundColor: "#ffffff" }}>
      <Show when={m.selected()} fallback={<Text style={[small, { padding: 48, textAlign: "center" }]}>No message selected</Text>}>
        <View ref={scroll.viewportRef} style={{ ...RELATIVE, flexGrow: 1, minHeight: 0, overflow: "hidden" }} onWheel={(e) => scroll.by(e.dy)}>
          <View ref={scroll.contentRef} style={{ marginTop: -scroll.y(), paddingTop: 28, paddingLeft: 36, paddingRight: 36, paddingBottom: 28, gap: 18 }}>
            <Text style={{ fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{m.selected()!.subject}</Text>
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
                  <Show when={isOpen(msg)} fallback={<FoldedMessage message={msg} onPress={() => toggle(msg.id)} />}>
                    <OpenMessage message={msg} onPress={msg.id === m.selected()?.id ? undefined : () => toggle(msg.id)} />
                  </Show>
                </>
              )}
            </For>
          </View>
          <ScrollThumb scroll={scroll} />
        </View>
        <Show when={m.panel()}>
          <Panel mail={m} />
        </Show>
      </Show>
    </View>
  );
}

// ---------------------------------------------------------------- shortcuts
const SHORTCUTS: [string, string][][] = [
  [["J / K", "Older / newer message"], ["1 / 2", "Important / Other"], ["/", "Search"], ["Esc", "Close, or leave search"], ["?", "These shortcuts"]],
  [["E", "Archive"], ["I", "Move to Inbox"], ["#", "Delete"], ["H", "Snooze"], ["L", "Labels"], ["S", "Star"], ["U", "Mark read / unread"], ["R", "Quick reply"], ["Z", "Undo"]],
];

function Shortcuts(props: { onClose: () => void }) {
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: C.backdrop, justifyContent: "center", alignItems: "center" }} onPress={props.onClose}>
      <View style={{ width: 560, paddingTop: 22, paddingBottom: 24, paddingLeft: 28, paddingRight: 28, gap: 18, borderRadius: 12, backgroundColor: "#ffffff" }} onPress={(e) => e.stopPropagation()}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flexGrow: 1, fontSize: 16, fontWeight: 700, color: C.text }}>Keyboard shortcuts</Text>
          <Kbd text="Esc" />
        </View>
        <View style={{ flexDirection: "row", gap: 32 }}>
          <For each={SHORTCUTS}>
            {(column) => (
              <View style={{ flexGrow: 1, flexBasis: 0, gap: 8 }}>
                <For each={column}>
                  {([keys, what]) => (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 52, flexShrink: 0, flexDirection: "row" }}>
                        <Kbd text={keys} />
                      </View>
                      <Text style={{ flexShrink: 1, fontSize: 13, color: C.text, maxLines: 1 }}>{what}</Text>
                    </View>
                  )}
                </For>
              </View>
            )}
          </For>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- app
function StatusBar(props: { mail: Mail; onHelp: () => void }) {
  const m = props.mail;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 28, flexShrink: 0, paddingLeft: 16, paddingRight: 12, gap: 12, backgroundColor: "#fafafa" }}>
      <Text style={{ flexShrink: 1, fontSize: 12, color: C.secondary, maxLines: 1 }}>{m.status() || `${m.list().length} conversations`}</Text>
      <Show when={m.status() && m.status() !== "Undone" && m.status() !== "Nothing to undo"}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 22, flexShrink: 0, paddingLeft: 6, paddingRight: 6, borderRadius: 5 }} onPress={m.undo}>
          <Text style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>Undo</Text>
          <Kbd text="Z" />
        </View>
      </Show>
      <View style={{ flexGrow: 1 }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22, flexShrink: 0, paddingLeft: 6, paddingRight: 4 }} onPress={props.onHelp}>
        <Text style={small}>Keyboard shortcuts</Text>
        <Kbd text="?" />
      </View>
    </View>
  );
}

export function App(props: { mail?: Mail }) {
  const m = props.mail ?? createMail();
  const ui = useUi();
  const [help, setHelp] = createSignal(false);
  createEffect(() => {
    const unread = m.unread({ kind: "all" });
    ui.title(unread ? `Mantou Mail — ${unread} unread` : "Mantou Mail");
  });
  onKey((e) => {
    if (e.type !== "keyDown" || e.ctrl || e.meta || e.alt) return;
    if (help()) {
      if (e.key === "Escape" || e.key === "?") setHelp(false);
      return;
    }
    if (m.searching()) {
      switch (e.key) {
        case "Escape": return m.cancelSearch();
        case "Enter": return m.submitSearch();
        case "Backspace": return m.backspace();
        case "ArrowDown": return m.move(1);
        case "ArrowUp": return m.move(-1);
      }
      if ([...e.key].length === 1) m.type(e.key);
      return;
    }
    const panel = m.panel();
    if (panel && /^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (panel === "reply" && QUICK_REPLIES[i]) return m.reply(QUICK_REPLIES[i]);
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
      case "/": return m.startSearch();
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
      <Sidebar mail={m} />
      <View style={vline} />
      <View style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
        <Toolbar mail={m} />
        <View style={hline} />
        {/* flexBasis 0: the row's height comes from the window, not from what's scrolled inside it. */}
        <View style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, flexDirection: "row" }}>
          <MessageList mail={m} />
          <View style={vline} />
          <Reader mail={m} />
        </View>
        <View style={hline} />
        <StatusBar mail={m} onHelp={() => setHelp(true)} />
      </View>
      <Show when={help()}>
        <Shortcuts onClose={() => setHelp(false)} />
      </Show>
    </View>
  );
}
