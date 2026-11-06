// Ask your inbox: a question, an answer from the agent, and the messages it came from (press one to open it).
import { For, Input, Show, Text, View, createSignal } from "mantou-ui";
import type { Ask } from "../agent/ask";
import type { Mail } from "../state";
import { C, field } from "./theme";

export function AskView(props: { mail: Mail; ask?: Ask }) {
  const m = props.mail;
  const [question, setQuestion] = createSignal("");
  const a = () => props.ask;
  const go = () => void a()?.run(question());
  return (
    <View style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 24, gap: 14 }}>
      <Show when={a()} fallback={<Text style={{ fontSize: 13, color: C.muted }}>Asking needs the agent, which isn't set up here.</Text>}>
        <Text style={{ fontSize: 13, color: C.secondary }}>Ask about your mail: “When is my flight to Porto?”, “What did Priya want me to review?”</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Input
            autoFocus
            value={question()}
            placeholder="Ask your inbox"
            onChange={setQuestion}
            onSubmit={go}
            style={[field(), { flexGrow: 1, flexShrink: 1, height: 36, paddingLeft: 12, paddingRight: 12, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }]}
          />
          <View style={{ height: 36, paddingLeft: 16, paddingRight: 16, borderRadius: 8, backgroundColor: C.accent, justifyContent: "center", opacity: a()!.running() ? 0.5 : 1 }} onPress={go}>
            <Text style={{ fontSize: 13, fontWeight: 600, color: "#ffffff" }}>{a()!.running() ? "Looking…" : "Ask"}</Text>
          </View>
        </View>
        <Show when={a()!.note()}>
          <Text style={{ fontSize: 12, color: C.danger }}>{a()!.note()}</Text>
        </Show>
        <Show when={a()!.answer()}>
            <View style={{ gap: 10, padding: 16, borderRadius: 10, backgroundColor: C.faint }}>
              <Text style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5 }}>{a()!.answer()!.question.toUpperCase()}</Text>
              <Text selectable style={{ fontSize: 14, lineHeight: 1.5, color: C.text }}>{a()!.answer()!.text}</Text>
              <Show when={a()!.answer()!.sources.length}>
                <Text style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.5 }}>FROM</Text>
                <For each={a()!.answer()!.sources}>
                  {(s) => (
                    <View style={{ cursor: "pointer" }} onPress={() => m.show(s.id)}>
                      <Text style={{ fontSize: 13, color: C.accentText, maxLines: 1 }}>{s.from.name} · {s.subject}</Text>
                    </View>
                  )}
                </For>
              </Show>
            </View>
        </Show>
      </Show>
    </View>
  );
}
