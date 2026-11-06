// The Queue: what the agent proposed, to approve or dismiss. Approving does it as if by hand (⌘Z/z undoes it).
import { For, Show, Text, View, Scroll } from "mantou-ui";
import type { Proposal } from "../agent/proposals";
import { longDate, type Message } from "../data";
import type { Mail } from "../state";
import { C, hline } from "./theme";

const VERB: Record<Proposal["kind"], string> = { archive: "Archive", moveToInbox: "Move to Inbox", markRead: "Mark as read", label: "Label", snooze: "Snooze" };
const SHOWN = 4;

const button = (label: string, primary: boolean, onPress: () => void) => (
  <View
    style={{ height: 30, paddingLeft: 14, paddingRight: 14, borderRadius: 7, justifyContent: "center", cursor: "pointer", backgroundColor: primary ? C.accent : "transparent", borderWidth: primary ? 0 : 1, borderColor: C.line }}
    onPress={onPress}
  >
    <Text style={{ fontSize: 13, fontWeight: 600, color: primary ? "#ffffff" : C.secondary }}>{label}</Text>
  </View>
);

function Card(props: { mail: Mail; proposal: Proposal; first: boolean }) {
  const m = props.mail;
  const p = () => props.proposal;
  const found = (): Message[] => p().ids.map((id) => m.messages().find((x) => x.id === id)).filter((x): x is Message => !!x);
  return (
    <View style={{ gap: 10, padding: 16, borderRadius: 10, borderWidth: 1, borderColor: props.first ? C.accent : C.line, backgroundColor: C.surface }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ flexGrow: 1, flexShrink: 1, fontSize: 14, fontWeight: 600, color: C.text }}>
          {VERB[p().kind]}{p().value ? ` “${p().kind === "snooze" ? longDate(new Date(p().value!)) : p().value}”` : ""} · {p().ids.length === 1 ? "1 conversation" : `${p().ids.length} conversations`}
        </Text>
      </View>
      <Text style={{ fontSize: 13, lineHeight: 1.5, color: C.secondary }}>{p().reason}</Text>
      <View style={{ gap: 4 }}>
        <For each={found().slice(0, SHOWN)}>
          {(msg) => (
            <Text style={{ fontSize: 12, color: C.muted, maxLines: 1 }}>
              {msg.from.name} · {msg.subject}
            </Text>
          )}
        </For>
        <Show when={found().length > SHOWN}>
          <Text style={{ fontSize: 12, color: C.muted }}>and {found().length - SHOWN} more</Text>
        </Show>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {button("Approve", true, () => m.approve(p().id))}
        {button("Dismiss", false, () => m.dismiss(p().id))}
        <Show when={props.first}>
          <Text style={{ alignSelf: "center", fontSize: 11, color: C.muted }}>Enter approves · X dismisses</Text>
        </Show>
      </View>
    </View>
  );
}

export function Queue(props: { mail: Mail }) {
  const m = props.mail;
  return (
    <View style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
      <Show
        when={m.proposals().length}
        fallback={
          <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Nothing waiting</Text>
            <Text style={{ fontSize: 13, color: C.muted }}>What the agent suggests shows up here, for you to approve.</Text>
          </View>
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", height: 40, paddingLeft: 20, paddingRight: 20 }}>
          <Text style={{ flexGrow: 1, fontSize: 12, color: C.muted }}>{m.proposals().length} to review. Nothing changes until you approve it.</Text>
        </View>
        <View style={hline()} />
        <Scroll style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }} contentStyle={{ padding: 20, gap: 12 }}>
          <For each={m.proposals()}>{(p, i) => <Card mail={m} proposal={p} first={i() === 0} />}</For>
        </Scroll>
      </Show>
    </View>
  );
}
