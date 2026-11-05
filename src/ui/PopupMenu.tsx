// A menu drawn by the app, where Mantou has no native one: context menus on
// Linux and Windows answer "cancelled" today. Workaround for dunkbing/mantou#21
// (context menus off macOS). It takes the same MenuItem list as showMenu and
// answers the same way: the chosen item's id, or null.
import { For, Show, Text, View, createSignal, onCleanup, onKey, showMenu, useUi, useWindowSize, type MenuItem, type Ui } from "mantou-ui";
import { C, dialogShadow } from "./theme";

/** Whether the system shows Mantou's own context menus (macOS); tests set it to try both. */
export const menus = { native: process.platform === "darwin" };

const WIDTH = 220, ITEM = 30, SEP = 9, PAD = 5;

type Open = { items: MenuItem[]; x: number; y: number; done: (id: string | null) => void };
/** Each window's host (its PopupHost): the menu is that window's state, not the module's. */
const hosts = new WeakMap<Ui, { show: (o: Open) => void; isOpen: () => boolean }>();

/** A drawn menu is open in this window (the app's keys wait while it is). */
export const popupOpen = (ui: Ui) => hosts.get(ui)?.isOpen() ?? false;

/** Shows a menu at (x, y) in `ui`'s window: the system's where there is one, else the app's own. */
export function contextMenu(ui: Ui, items: MenuItem[], at: { x: number; y: number }): Promise<string | null> {
  const host = hosts.get(ui);
  if (menus.native || !host) return showMenu(items, at);
  return new Promise((done) => host.show({ items, x: at.x, y: at.y, done }));
}

/** Where the drawn menu goes: one per window, over everything (App renders it last). */
export function PopupHost() {
  const ui = useUi();
  const size = useWindowSize();
  const [open, setOpen] = createSignal<Open | null>(null);
  hosts.set(ui, {
    show: (o) => {
      open()?.done(null);
      setOpen(o);
    },
    isOpen: () => open() !== null,
  });
  onCleanup(() => hosts.delete(ui));
  const [active, setActive] = createSignal(-1);
  const choosable = () => (open()?.items ?? []).map((it, i) => (it.separator || it.enabled === false ? -1 : i)).filter((i) => i >= 0);
  const close = (id: string | null) => {
    const o = open();
    setOpen(null);
    setActive(-1);
    o?.done(id);
  };
  const step = (by: number) => {
    const c = choosable();
    if (!c.length) return;
    const at = c.indexOf(active());
    setActive(c[at < 0 ? (by > 0 ? 0 : c.length - 1) : (at + by + c.length) % c.length]);
  };
  onKey((e) => {
    if (e.type !== "keyDown" || !open()) return;
    if (e.key === "Escape") close(null);
    else if (e.key === "ArrowDown") step(1);
    else if (e.key === "ArrowUp") step(-1);
    else if (e.key === "Enter" && active() >= 0) close(open()!.items[active()].id ?? open()!.items[active()].label ?? null);
  });
  // Kept inside the window: flipped up or left when it would run off the edge.
  const place = () => {
    const o = open()!;
    const h = PAD * 2 + o.items.reduce((n, it) => n + (it.separator ? SEP : ITEM), 0);
    const w = size().width || Infinity, wh = size().height || Infinity;
    return { left: o.x + WIDTH > w ? Math.max(0, o.x - WIDTH) : o.x, top: o.y + h > wh ? Math.max(0, o.y - h) : o.y };
  };
  return (
    <Show when={open()}>
      {/* The rest of the window: a press anywhere closes the menu (and goes no further). */}
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} onPress={() => close(null)} onContextMenu={() => close(null)}>
        <View
          style={{ position: "absolute", ...place(), width: WIDTH, paddingTop: PAD, paddingBottom: PAD, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: dialogShadow }}
          onPress={(e) => e.stopPropagation()}
        >
          <For each={open()!.items}>
            {(it, i) =>
              it.separator ? (
                <View style={{ height: 1, marginTop: (SEP - 1) / 2, marginBottom: (SEP - 1) / 2, backgroundColor: C.line }} />
              ) : (
                <View
                  style={{ height: ITEM, justifyContent: "center", marginLeft: PAD, marginRight: PAD, paddingLeft: 10, paddingRight: 10, borderRadius: 5, backgroundColor: active() === i() ? C.accentSoft : "transparent", opacity: it.enabled === false ? 0.45 : 1 }}
                  onHover={(on) => on && it.enabled !== false && setActive(i())}
                  onPress={() => it.enabled !== false && close(it.id ?? it.label ?? null)}
                >
                  <Text style={{ fontSize: 13, color: active() === i() ? C.accentText : C.text, maxLines: 1 }}>{it.label ?? ""}</Text>
                </View>
              )
            }
          </For>
        </View>
      </View>
    </Show>
  );
}
