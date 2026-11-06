// The reader: the selected message's conversation, and the panel under it
// (reply, snooze, labels).
import { For, Html, Show, Text, View, createEffect, createMemo, createSignal, on, Scroll, useColorScheme, type Node } from "mantou-ui";
import { LABELS, daysSince, longDate, shortDate, type Attachment, type Message } from "../data";
import { homedir } from "node:os";
import type { Remote } from "../mail/remote";
import { SNOOZE_OPTIONS, type Mail } from "../state";
import { C, hline, caption, small } from "./theme";
import type { Replies } from "../agent/replies";
import { safeHtml } from "../mail/html";
import { isLong, type Summaries } from "../agent/summary";
import { Avatar, Chip, LabelChips, Kbd, AttachmentChip, TextButton, linkParts } from "./common";
import { ReplyComposer } from "./Compose";
import { Icon } from "./icons";

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
  const save = (a: Attachment) => {
    if (!props.remote) return props.mail.note("Attachments save in the app, with its data folder");
    props.remote.saveAttachment(msg(), a).then(
      (path) => path && props.mail.note(`Saved “${a.name}” to ${path.replace(homedir(), "~")}`),
      (e: Error) => props.mail.note(`Couldn't save “${a.name}”: ${e.message}`),
    );
  };
  const to = () => props.mail.accountOf(msg().account)?.email ?? "";
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }} onPress={props.onPress}>
        <Avatar name={msg().from.name} size={40} />
        <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: 600, color: C.text, maxLines: 1 }}>{displayName(props.mail, msg())}</Text>
          <Text style={[small(), { maxLines: 1 }]}>{`${msg().from.email} → ${(msg().to?.length ? msg().to!.map((c) => c.email).join(", ") : props.mail.isMine(msg().from) ? "no recipients yet" : to())}${msg().cc?.length ? `, cc ${msg().cc!.map((c) => c.email).join(", ")}` : ""}${msg().bcc?.length ? `, bcc ${msg().bcc!.map((c) => c.email).join(", ")}` : ""}`}</Text>
        </View>
        <Text style={small()}>{longDate(msg().date)}</Text>
      </View>
      <View style={{ gap: 14 }}>
        <Show when={msg().html} fallback={
          <For each={msg().body}>
            {(p) => (
              <Text selectable style={{ fontSize: 14, lineHeight: 1.6, color: C.body }}>
                <For each={linkParts(p)}>
                  {(part) =>
                    part.url ? (
                      <Text style={{ color: C.accentText, textDecoration: "underline", cursor: "pointer" }} onPress={() => props.remote?.openLink(part.url!)}>{part.text}</Text>
                    ) : (
                      part.text
                    )
                  }
                </For>
              </Text>
            )}
          </For>
        }>
          <MailHtml html={msg().html!} remote={props.remote} />
        </Show>
      </View>
      <Show when={msg().attachments?.length}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <For each={msg().attachments}>{(a) => <AttachmentChip attachment={a} onPress={() => open(a)} onSave={() => save(a)} />}</For>
        </View>
      </Show>
    </View>
  );
}

/** An image or stylesheet a mail asks for on the web, when the person has allowed it: its bytes, or null. */
async function fetchRemote(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/^(image\/|text\/css)/i.test(type)) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    return bytes.length > 5_000_000 ? null : bytes;
  } catch {
    return null;
  }
}

/**
 * A message's HTML, drawn by Mantou (no scripts run). Pictures from the web are blocked until the person
 * allows them (they tell the sender the mail was opened); pictures inside the message are already in it.
 */
function MailHtml(props: { html: string; remote?: Remote }) {
  const system = useColorScheme();
  const html = createMemo(() => safeHtml(props.html)); // Workaround for dunkbing/mantou#87
  // Most mail has no dark styles: its dark text needs a light page, so it gets one (a white card) unless it asks for dark.
  const dark = () => system() === "dark" && /prefers-color-scheme/i.test(props.html);
  const scheme = () => (dark() ? "dark" : "light");
  const [allowed, setAllowed] = createSignal(false);
  const [blocked, setBlocked] = createSignal(0);
  const loader = (allow: boolean) => async (url: string) => {
    if (!/^https?:/i.test(url)) return null;
    if (allow) return fetchRemote(url);
    setBlocked((n) => n + 1);
    return null;
  };
  const link = (url: string) => {
    if (/^(https?|mailto):/i.test(url)) props.remote?.openLink(url);
  };
  return (
    <View style={{ gap: 10 }}>
      <Show when={!allowed() && blocked() > 0}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 8, borderRadius: 8, backgroundColor: C.faint }}>
          <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 12, color: C.secondary }}>Pictures from the web are blocked, so the sender can't tell you opened this.</Text>
          <TextButton label="Load pictures" onPress={() => setAllowed(true)} />
        </View>
      </Show>
      {/* Asked once per address: allowing starts a new document, which asks again. */}
      <View style={{ borderRadius: 8, overflow: "hidden", backgroundColor: dark() ? "transparent" : "#ffffff" }}>
      <Show when={allowed()} fallback={<Html html={html()} colorScheme={scheme()} loadImage={loader(false)} onLink={link} style={{ width: "100%" }} />}>
        <Html html={html()} colorScheme={scheme()} loadImage={loader(true)} onLink={link} style={{ width: "100%" }} />
      </Show>
      </View>
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
      <Text style={[small(), { flexShrink: 0 }]}>{shortDate(msg().date)}</Text>
    </View>
  );
}

export function Panel(props: { mail: Mail; remote?: Remote; replies?: Replies }) {
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
      <View style={hline()} />
      <View style={{ paddingTop: 14, paddingBottom: 16, paddingLeft: 36, paddingRight: 36, gap: 10, backgroundColor: C.subtle }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={[caption(), { flexGrow: 1, flexShrink: 1, maxLines: 1 }]}>
            {m.panel() === "reply" ? (m.replyingAll() ? "REPLY ALL" : "REPLY") : m.panel() === "snooze" ? "SNOOZE UNTIL" : "LABELS"}
          </Text>
          <Text style={[caption(), { fontWeight: 500 }]}>{m.panel() === "reply" ? "Esc keeps a draft" : "Esc to close"}</Text>
        </View>
        <Show when={m.panel() === "reply"}>
          <ReplyComposer mail={m} remote={props.remote} replies={props.replies} />
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

/** A long conversation's summary, or a button to write one (it sends the conversation to the agent, so it's asked for). */
function SummaryCard(props: { summaries: Summaries; conversation: Message[] }) {
  const s = props.summaries;
  const text = () => s.cached(props.conversation);
  const busy = () => s.running() !== null;
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 8, backgroundColor: C.faint }}>
      <Show
        when={text()}
        fallback={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 12, color: C.secondary }}>{s.running() ? "Reading the conversation…" : s.note() || "Long conversation."}</Text>
            <View style={{ opacity: busy() ? 0.5 : 1 }}>
              <TextButton label="Summarise" onPress={() => void s.run(props.conversation)} />
            </View>
          </View>
        }
      >
        <Text style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5 }}>SUMMARY</Text>
        <Text selectable style={{ fontSize: 13, lineHeight: 1.5, color: C.body }}>{text()}</Text>
      </Show>
    </View>
  );
}

export function Reader(props: { mail: Mail; remote?: Remote; summaries?: Summaries; replies?: Replies }) {
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
    <View style={{ flexGrow: 1, flexShrink: 1, backgroundColor: C.surface }}>
      <Show
        when={m.picked().size < 2 && m.selected()}
        fallback={<Text style={[small(), { padding: 48, textAlign: "center" }]}>{m.picked().size > 1 ? `${m.picked().size} conversations selected` : "No message selected"}</Text>}
      >
        <Scroll ref={(n) => (scroll = n)} style={{ flexGrow: 1, minHeight: 0 }}>
          <View style={{ paddingTop: 28, paddingLeft: 36, paddingRight: 36, paddingBottom: 28, gap: 18 }}>
            <Text selectable style={{ fontSize: 21, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{m.selected()!.subject || "(no subject)"}</Text>
            <Show when={m.selected()!.folder === "scheduled" && m.selected()!.outbox?.at}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 10, borderRadius: 8, backgroundColor: C.accentSoft }}>
                <Icon name="calendar" size={16} color={C.accent} />
                <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 13, fontWeight: 500, color: C.accent, maxLines: 1 }}>{`Scheduled for ${longDate(new Date(m.selected()!.outbox!.at!))}`}</Text>
                <View style={{ height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 6, justifyContent: "center", backgroundColor: C.accent }} onPress={m.sendNow}>
                  <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>Send now</Text>
                </View>
                <View style={{ height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 6, justifyContent: "center", borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }} onPress={m.editScheduled}>
                  <Text style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Edit</Text>
                </View>
              </View>
            </Show>
            <Show when={m.selected()!.folder === "drafts"}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Chip text="Draft" color={C.danger} background={C.dangerSoft} />
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
                  <Chip text={`Waiting for reply · ${daysSince(m.selected()!.waitingSince!)}d`} color={C.warn} background={C.warnSoft} />
                </Show>
                <LabelChips message={m.selected()!} />
              </View>
            </Show>
            <Show when={props.summaries && isLong(m.conversation())}>
              <SummaryCard summaries={props.summaries!} conversation={m.conversation()} />
            </Show>
            <For each={m.conversation()}>
              {(msg) => (
                <>
                  <View style={hline()} />
                  <Show when={isOpen(msg)} fallback={<FoldedMessage mail={m} message={msg} onPress={() => toggle(msg.id)} />}>
                    <OpenMessage mail={m} remote={props.remote} message={msg} onPress={msg.id === m.selected()?.id ? undefined : () => toggle(msg.id)} />
                  </Show>
                </>
              )}
            </For>
          </View>
        </Scroll>
        <Show when={m.panel()}>
          <Panel mail={m} remote={props.remote} replies={props.replies} />
        </Show>
      </Show>
    </View>
  );
}
