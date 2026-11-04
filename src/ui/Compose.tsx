// Writing mail: the reply composer under the reader, and the new-message composer.
import { For, Input, Show, Text, View, createSignal, defineStyle, type Node } from "mantou-ui";
import type { Remote } from "../mail/remote";
import { Icon } from "./icons";
import { QUICK_REPLIES, type Mail } from "../state";
import { C, hline, small, field } from "./theme";
import { AttachmentChip, Kbd, SendButton, TextButton } from "./common";

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
 * Attach: the system's file picker, or, where there's none, a field for a
 * file's path. Workaround for dunkbing/mantou#21 (native dialogs).
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

/** A reply, written under the conversation. Quick replies are starting points. */
export function ReplyComposer(props: { mail: Mail; remote?: Remote }) {
  const m = props.mail;
  let body: Node | undefined;
  return (
    <View style={{ gap: 10 }}>
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
        onSubmit={() => m.send()}
        style={[field, { height: 112, paddingTop: 10, paddingBottom: 10, paddingLeft: 12, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: "#ffffff", lineHeight: 1.5 }]}
      />
      <DraftAttachments mail={m} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SendButton onPress={() => m.send()} />
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
  let subject: Node | undefined;
  let body: Node | undefined;
  const label = (text: string) => <Text style={{ width: 64, flexShrink: 0, fontSize: 13, color: C.muted }}>{text}</Text>;
  const row = defineStyle({ flexDirection: "row", alignItems: "center", minHeight: 44, paddingLeft: 20, paddingRight: 20 });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: C.backdrop, justifyContent: "center", alignItems: "center" }} onPress={m.closeCompose}>
      {/* focusScope: Tab stays among the composer's fields, and the focus goes back where it was when it closes. */}
      <View focusScope style={{ width: 680, borderRadius: 12, overflow: "hidden", backgroundColor: "#ffffff" }} onPress={(e) => e.stopPropagation()}>
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
        <View style={row}>
          {label("To")}
          <Input
            autoFocus={!m.draft().to /* a draft with recipients starts in the text */}
            value={m.draft().to}
            placeholder="Name <email>, separated by commas"
            onChange={(to) => m.editDraft({ to })}
            onSubmit={() => subject?.focus()}
            style={[field, { flexGrow: 1, flexBasis: 0, height: 32 }]}
          />
        </View>
        <View style={hline} />
        <View style={row}>
          {label("Subject")}
          <Input
            ref={(n) => (subject = n)}
            value={m.draft().subject}
            placeholder="What it's about"
            onChange={(subject) => m.editDraft({ subject })}
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
          placeholder="Write your message"
          onChange={(body) => m.editDraft({ body })}
          onSubmit={() => m.send()}
          style={[field, { height: 280, paddingTop: 14, paddingBottom: 14, paddingLeft: 20, paddingRight: 20, lineHeight: 1.5 }]}
        />
        <Show when={m.draft().attachments?.length}>
          <View style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 12 }}>
            <DraftAttachments mail={m} />
          </View>
        </Show>
        <View style={hline} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 56, paddingLeft: 16, paddingRight: 16 }}>
          <SendButton onPress={() => m.send()} />
          <TextButton label="Discard" onPress={m.discard} />
          <AttachButton mail={m} remote={props.remote} />
          <Problem mail={m} />
        </View>
      </View>
    </View>
  );
}
