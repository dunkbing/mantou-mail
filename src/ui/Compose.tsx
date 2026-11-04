// Writing mail: the reply composer under the reader, and the new-message composer.
import { For, Input, Show, Text, View, createMemo, createSignal, defineStyle, onKey, type Node } from "mantou-ui";
import type { Remote } from "../mail/remote";
import { Icon } from "./icons";
import { QUICK_REPLIES, acceptRecipient, parseRecipients, sendLaterOptions, suggestRecipients, type Mail } from "../state";
import { now } from "../data";
import { whenShort } from "./MessageList";
import { C, hline, small, field, dialogShadow } from "./theme";
import { AttachmentChip, Avatar, Kbd, SendButton, TextButton } from "./common";

type Line = "to" | "cc" | "bcc";
const LINE_NAMES: Record<Line, string> = { to: "To", cc: "Cc", bcc: "Bcc" };
/** The address line being typed in, for its suggestions (the others hide theirs). */
const [activeLine, setActiveLine] = createSignal<Line | null>(null);

/**
 * An address line (To, Cc, Bcc), with the people you've written with
 * suggested under it as you type: Down and Up pick one, a press takes it, and
 * so does Enter, unless what's typed is already a whole address (or there's
 * nothing to take): then Enter goes on to the next field.
 */
function AddressField(props: { mail: Mail; line: Line; autoFocus?: boolean; inset?: number; onNext?: () => void; ref?: (n: Node) => void; trailing?: () => any }) {
  const m = props.mail;
  const value = () => m.draft()[props.line] ?? "";
  const [pick, setPick] = createSignal(0);
  const [moved, setMoved] = createSignal(false);
  // Workaround for dunkbing/mantou#30: the caret stays where it was when the
  // app replaces the text, so taking a suggestion makes a new input (whose
  // caret starts at the end).
  const [generation, setGeneration] = createSignal(0);
  const suggestions = createMemo(() => (activeLine() === props.line ? suggestRecipients(value(), m.contacts()) : []));
  const take = (i: number) => {
    const c = suggestions()[i];
    if (!c) return false;
    m.editDraft({ [props.line]: acceptRecipient(value(), c) });
    setPick(0);
    setMoved(false);
    setGeneration(generation() + 1);
    return true;
  };
  const whole = () => parseRecipients(value().slice(value().lastIndexOf(",") + 1)).ok.length > 0;
  onKey((e) => {
    if (e.type !== "keyDown" || activeLine() !== props.line || !suggestions().length) return;
    if (e.key === "ArrowDown") (setPick((pick() + 1) % suggestions().length), setMoved(true));
    if (e.key === "ArrowUp") (setPick((pick() - 1 + suggestions().length) % suggestions().length), setMoved(true));
  });
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, paddingLeft: props.inset ?? 20, paddingRight: props.inset ?? 20 }}>
        <Text style={{ width: 64, flexShrink: 0, fontSize: 13, color: C.muted }}>{LINE_NAMES[props.line]}</Text>
        <For each={[generation()]}>
          {(g) => (
            <Input
              ref={(n) => props.ref?.(n)}
              autoFocus={g > 0 || props.autoFocus}
              value={value()}
              placeholder={props.line === "to" ? "Name <email>, separated by commas" : ""}
              onChange={(v) => (m.editDraft({ [props.line]: v }), setPick(0), setMoved(false))}
              onFocus={() => setActiveLine(props.line)}
              onSubmit={() => ((moved() || !whole()) && take(pick())) || props.onNext?.()}
              style={[field, { flexGrow: 1, flexBasis: 0, height: 32 }]}
            />
          )}
        </For>
        {props.trailing?.()}
      </View>
      <Show when={suggestions().length}>
        <View style={{ paddingLeft: (props.inset ?? 20) + 56, paddingRight: props.inset ?? 20, paddingBottom: 8, gap: 2 }}>
          <For each={suggestions()}>
            {(c, i) => (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 34, paddingLeft: 8, paddingRight: 8, borderRadius: 7, backgroundColor: i() === pick() ? C.accentSoft : "transparent" }}
                onPress={() => take(i())}
              >
                <Avatar name={c.name} size={22} />
                <Text style={{ fontSize: 13, fontWeight: 500, color: C.text, maxLines: 1, flexShrink: 0 }}>{c.name}</Text>
                <Text style={{ fontSize: 12, color: C.muted, maxLines: 1, flexShrink: 1 }}>{c.email}</Text>
              </View>
            )}
          </For>
        </View>
      </Show>
    </>
  );
}

/** Why the draft can't be sent yet, beside the Send button. */
export function Problem(props: { mail: Mail }) {
  return (
    <Show when={props.mail.problem()}>
      <Text style={{ flexShrink: 1, fontSize: 12, color: "#b91c1c", maxLines: 1 }}>{props.mail.problem()}</Text>
    </Show>
  );
}

/** The draft's attachments, each with × to take it off. */
function DraftAttachments(props: { mail: Mail }) {
  return (
    <Show when={props.mail.draft().attachments?.length}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <For each={props.mail.draft().attachments}>{(a, i) => <AttachmentChip attachment={a} onRemove={() => props.mail.removeAttachment(i())} />}</For>
      </View>
    </Show>
  );
}

/**
 * Attach: the system's file dialog, or, where it has none, a field for a
 * file's path. Workaround for dunkbing/mantou#28 (no way to tell).
 */
function AttachButton(props: { mail: Mail; remote?: Remote }) {
  const [asking, setAsking] = createSignal(false);
  const [path, setPath] = createSignal("");
  const add = async (paths: string[]) => {
    try {
      props.mail.addAttachments(await props.remote!.attachFiles(paths));
      setAsking(false);
      setPath("");
    } catch (e) {
      props.mail.showProblem((e as Error).message);
    }
  };
  const pick = async () => {
    if (!props.remote) return props.mail.showProblem("Attaching files needs the app's data folder");
    const chosen = await props.remote.pickFiles();
    if (chosen === null) setAsking(true); // no picker on this system: type the path
    else if (chosen.length) await add(chosen);
  };
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, flexShrink: 0, paddingLeft: 8, paddingRight: 10, borderRadius: 7 }} onPress={() => void pick()}>
        <Icon name="paperclip" size={14} color={C.secondary} />
        <Text style={{ fontSize: 13, fontWeight: 500, color: C.secondary }}>Attach</Text>
      </View>
      <Show when={asking()}>
        <Input
          autoFocus
          value={path()}
          onChange={setPath}
          onSubmit={(v) => v.trim() && void add([v.trim()])}
          placeholder="Path to a file, then Enter"
          style={[field, { flexGrow: 1, flexBasis: 0, height: 30, paddingLeft: 8, fontSize: 13, borderRadius: 6, borderWidth: 1, borderColor: C.line }]}
        />
      </Show>
    </>
  );
}

/** "Send later": opens the row of times (SendLaterTimes) under it. */
function SendLaterButton(props: { open: boolean; onPress: () => void }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 32, flexShrink: 0, paddingLeft: 10, paddingRight: 10, borderRadius: 7, borderWidth: 1, borderColor: props.open ? C.accent : C.line, backgroundColor: props.open ? C.accentSoft : "#ffffff" }}
      onPress={props.onPress}
    >
      <Icon name="calendar" size={14} color={props.open ? C.accent : C.secondary} />
      <Text style={{ fontSize: 13, fontWeight: 500, color: props.open ? C.accent : C.secondary }}>Send later</Text>
    </View>
  );
}

/** When to send it: the presets, each with its day and time. Pressing one schedules the draft. */
function SendLaterTimes(props: { mail: Mail }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <For each={sendLaterOptions(now())}>
        {(o) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff" }} onPress={() => props.mail.send(o.at)}>
            <Text style={{ fontSize: 13, color: C.text }}>{o.name}</Text>
            <Text style={{ fontSize: 12, color: C.muted }}>{whenShort(o.at)}</Text>
          </View>
        )}
      </For>
    </View>
  );
}

/** A reply, written under the conversation. Quick replies are starting points. */
export function ReplyComposer(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  const [later, setLater] = createSignal(false);
  /** The address lines, open to change who it goes to. */
  const [editing, setEditing] = createSignal(false);
  let body: Node | undefined;
  const summary = () => {
    const d = m.draft(), names = (line: string | undefined) => parseRecipients(line ?? "", m.contacts()).ok.map((c) => c.name).join(", ");
    return [["To", names(d.to)], ["Cc", names(d.cc)], ["Bcc", names(d.bcc)]].filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join("  ·  ") || "No recipients yet";
  };
  return (
    <View style={{ gap: 10 }}>
      <Show
        when={editing()}
        fallback={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={[small, { flexGrow: 1, flexShrink: 1, maxLines: 1, color: C.secondary }]}>{summary()}</Text>
            <Show when={m.othersOnReply().length}>
              <TextButton label={m.replyingAll() ? "Reply to sender" : "Reply all"} onPress={() => (m.setReplyAll(!m.replyingAll()), body?.focus())} />
            </Show>
            <TextButton label="Edit recipients" onPress={() => setEditing(true)} />
          </View>
        }
      >
        <View style={{ borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff" }}>
          <AddressField mail={m} line="to" inset={12} onNext={() => body?.focus()} />
          <View style={hline} />
          <AddressField mail={m} line="cc" inset={12} onNext={() => body?.focus()} />
          <View style={hline} />
          <AddressField mail={m} line="bcc" inset={12} onNext={() => body?.focus()} />
        </View>
      </Show>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <For each={QUICK_REPLIES}>
          {(text) => (
            <View style={{ height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff", justifyContent: "center" }} onPress={() => {
                m.insertReply(text);
                body?.focus(); // the press took the focus; give it back to keep typing
              }}>
              <Text style={{ fontSize: 12, color: C.text }}>{text}</Text>
            </View>
          )}
        </For>
      </View>
      <Input
        ref={(n) => (body = n)}
        multiline
        autoFocus
        value={m.draft().body}
        placeholder="Write a reply"
        onChange={(body) => m.editDraft({ body })}
        onFocus={() => setActiveLine(null)}
        onSubmit={() => m.send()}
        style={[field, { height: 112, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff", lineHeight: 1.5 }]}
      />
      <DraftAttachments mail={m} />
      <Show when={later()}>
        <SendLaterTimes mail={m} />
      </Show>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SendButton onPress={() => m.send()} />
        <SendLaterButton open={later()} onPress={() => setLater(!later())} />
        <TextButton label="Discard" onPress={m.discard} />
        <AttachButton mail={m} remote={props.remote} />
        <Problem mail={m} />
      </View>
    </View>
  );
}

/** A new message (or a saved draft), over the app: From, To, Subject, the text. */
export function Composer(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  const [later, setLater] = createSignal(false);
  let subject: Node | undefined;
  let body: Node | undefined;
  let cc: Node | undefined;
  let bcc: Node | undefined;
  /** The Cc and Bcc lines: shown when the draft has copies, or on "Cc Bcc". */
  const [copies, setCopies] = createSignal(!!(m.draft().cc?.trim() || m.draft().bcc?.trim()));
  const label = (text: string) => <Text style={{ width: 64, flexShrink: 0, fontSize: 13, color: C.muted }}>{text}</Text>;
  const row = defineStyle({ flexDirection: "row", alignItems: "center", minHeight: 44, paddingLeft: 20, paddingRight: 20 });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: C.backdrop, justifyContent: "center", alignItems: "center" }} onPress={m.closeCompose}>
      {/* focusScope: Tab stays among the composer's fields, and the focus goes back where it was when it closes. */}
      <View focusScope style={{ width: 680, borderRadius: 12, overflow: "hidden", backgroundColor: "#ffffff", boxShadow: dialogShadow }} onPress={(e) => e.stopPropagation()}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 48, paddingLeft: 20, paddingRight: 16, backgroundColor: "#fafafa" }}>
          <Text style={{ flexGrow: 1, fontSize: 15, fontWeight: 600, color: C.text }}>{m.draft().id === null ? "New message" : "Draft"}</Text>
          <Text style={[small, { paddingRight: 8 }]}>Esc keeps it in Drafts</Text>
          <Kbd text="Esc" />
        </View>
        <View style={hline} />
        <View style={[row, { gap: 6 }]}>
          {label("From")}
          <For each={m.accounts()}>
            {(a) => (
              <View
                style={{ height: 28, paddingLeft: 10, paddingRight: 10, borderRadius: 14, borderWidth: 1, justifyContent: "center", borderColor: m.draft().account === a.id ? C.accent : C.line, backgroundColor: m.draft().account === a.id ? C.accentSoft : "#ffffff" }}
                onPress={() => m.editDraft({ account: a.id })}
              >
                <Text style={{ fontSize: 12, fontWeight: 500, color: m.draft().account === a.id ? C.accent : C.secondary }}>{`${a.name} · ${a.email}`}</Text>
              </View>
            )}
          </For>
        </View>
        <View style={hline} />
        {/* a draft with recipients starts in the text */}
        <AddressField mail={m} line="to" autoFocus={!m.draft().to} onNext={() => (copies() ? cc : subject)?.focus()} trailing={() => (
          <Show when={!copies()}>
            <TextButton label="Cc Bcc" onPress={() => setCopies(true)} />
          </Show>
        )} />
        <Show when={copies()}>
          <View style={hline} />
          <AddressField mail={m} line="cc" ref={(n) => (cc = n)} onNext={() => bcc?.focus()} />
          <View style={hline} />
          <AddressField mail={m} line="bcc" ref={(n) => (bcc = n)} onNext={() => subject?.focus()} />
        </Show>
        <View style={hline} />
        <View style={row}>
          {label("Subject")}
          <Input
            ref={(n) => (subject = n)}
            value={m.draft().subject}
            placeholder="What it's about"
            onChange={(subject) => m.editDraft({ subject })}
            onFocus={() => setActiveLine(null)}
            onSubmit={() => body?.focus()}
            style={[field, { flexGrow: 1, flexBasis: 0, height: 32 }]}
          />
        </View>
        <View style={hline} />
        <Input
          ref={(n) => (body = n)}
          multiline
          autoFocus={!!m.draft().to}
          value={m.draft().body}
          placeholder="Write your message: **bold**, *italic*, - lists and links go formatted"
          onChange={(body) => m.editDraft({ body })}
          onFocus={() => setActiveLine(null)}
          onSubmit={() => m.send()}
          style={[field, { height: 280, paddingTop: 14, paddingBottom: 14, paddingLeft: 20, paddingRight: 20, lineHeight: 1.5 }]}
        />
        <Show when={m.draft().attachments?.length}>
          <View style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 12 }}>
            <DraftAttachments mail={m} />
          </View>
        </Show>
        <View style={hline} />
        <Show when={later()}>
          <View style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12 }}>
            <SendLaterTimes mail={m} />
          </View>
        </Show>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 56, paddingLeft: 16, paddingRight: 16 }}>
          <SendButton onPress={() => m.send()} />
          <SendLaterButton open={later()} onPress={() => setLater(!later())} />
          <TextButton label="Discard" onPress={m.discard} />
          <AttachButton mail={m} remote={props.remote} />
          <Problem mail={m} />
        </View>
      </View>
    </View>
  );
}
