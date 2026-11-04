// The status bar: what just happened (with Undo), and the shortcuts hint.
import { Show, Text, View } from "mantou-ui";
import { type Mail } from "../state";
import { C, small } from "./theme";
import { Kbd } from "./common";
import { STATE_COLOR } from "./Accounts";
import { Icon } from "./icons";
import type { Remote } from "../mail/remote";
import type { SyncStatus } from "../mail/imap";

export function StatusBar(props: { mail: Mail; remote?: Remote; onHelp: () => void }) {
  const m = props.mail;
  /** The account most in need of attention, or the first one syncing. */
  const sync = () => {
    const all = Object.values(props.remote?.statuses() ?? {});
    const rank = (s: SyncStatus) => ["needs-password", "error", "offline", "connecting", "syncing", "ready"].indexOf(s.state);
    return all.sort((a, b) => rank(a) - rank(b))[0];
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height: 28, flexShrink: 0, paddingLeft: 16, paddingRight: 12, gap: 12, backgroundColor: C.subtle }}>
      <Text style={{ flexShrink: 1, fontSize: 12, color: C.secondary, maxLines: 1 }}>{m.status() || `${m.list().length} conversations`}</Text>
      <Show when={m.undoable()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 22, flexShrink: 0, paddingLeft: 6, paddingRight: 6, borderRadius: 5 }} onPress={m.undo}>
          <Text style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>Undo</Text>
          <Kbd text="Z" />
        </View>
      </Show>
      <View style={{ flexGrow: 1 }} />
      <Show when={sync()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, flexShrink: 0, backgroundColor: STATE_COLOR[sync()?.state ?? "ready"] }} />
          <Text style={[small(), { flexShrink: 1, maxLines: 1 }]}>{sync()?.detail ?? ""}</Text>
        </View>
      </Show>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22, flexShrink: 0, paddingLeft: 6, paddingRight: 4 }} onPress={props.onHelp}>
        <Icon name="keyboard" size={14} color={C.muted} />
        <Text style={small()}>Keyboard shortcuts</Text>
        <Kbd text="?" />
      </View>
    </View>
  );
}
