// The keyboard shortcuts overlay (?).
import { For, Text, View } from "mantou-ui";
import { SEND_KEYS, C } from "./theme";
import { Kbd } from "./common";

export const SHORTCUTS: [string, string][][] = [
  [["J / K", "Older / newer message"], ["1 / 2", "Important / Other"], ["/", "Search"], ["C", "Compose"], ["R", "Reply"], ["F", "Forward"], [SEND_KEYS, "Send"], ["Enter", "Open a draft"], ["Esc", "Close (keeps a draft), leave search"], ["?", "These shortcuts"]],
  [["E", "Archive"], ["I", "Move to Inbox"], ["#", "Delete"], ["H", "Snooze"], ["L", "Labels"], ["S", "Star"], ["U", "Mark read / unread"], ["Z", "Undo"]],
];

export function Shortcuts(props: { onClose: () => void }) {
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: C.backdrop, justifyContent: "center", alignItems: "center" }} onPress={props.onClose}>
      <View style={{ width: 640, paddingTop: 22, paddingBottom: 24, paddingLeft: 28, paddingRight: 28, gap: 18, borderRadius: 12, backgroundColor: "#ffffff" }} onPress={(e) => e.stopPropagation()}>
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
                      <View style={{ width: 84, flexShrink: 0, flexDirection: "row" }}>
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
