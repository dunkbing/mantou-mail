// The handle between the message list and the reader: drag it to change the list's width; double-click resets it.
import { View, createSignal } from "mantou-ui";
import { C } from "./theme";
import { LIST_WIDTH, dragListWidth, endListDrag, listWidth } from "./layout";

export function ResizeHandle() {
  const [hot, setHot] = createSignal(false);
  let from: { x: number; width: number } | null = null;
  return (
    // A wider strip than the line, so it's easy to grab; the line is drawn in its middle (no negative margins: the next sibling would cover half of it).
    <View
      style={{ width: 7, flexShrink: 0, alignItems: "center", cursor: "colResize", backgroundColor: C.surface /* a view with no background isn't hit: dunkbing/mantou#56 */ }}
      onHover={setHot}
      onPointerDown={(e) => (from = { x: e.x, width: listWidth() })}
      onPointerMove={(e) => from && e.buttons & 1 && dragListWidth(from.width + e.x - from.x)}
      onPointerUp={() => {
        if (from) endListDrag();
        from = null;
      }}
      onDoubleClick={() => (dragListWidth(LIST_WIDTH.default), endListDrag())}
    >
      <View style={{ width: hot() ? 3 : 1, flexGrow: 1, backgroundColor: hot() ? C.accent : C.line }} />
    </View>
  );
}
