import { Show, View, createSignal, type Node } from "mantou-ui";

// Scroll areas. Workaround for dunkbing/mantou#5 (scroll views): Mantou
// doesn't scroll in the core yet, so a scroll area is a clipping viewport whose
// content moves up by a negative margin as the wheel turns, with a thumb drawn
// from measurements. Replace all of this with the core's scroll view.
export function createScroll() {
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
export type Scroll = ReturnType<typeof createScroll>;
export const RELATIVE = { position: "relative" } as const;

/**
 * A thin scrollbar thumb, while the content is taller than its viewport. The
 * viewport needs `position: "relative"` (RELATIVE below). Workaround: Mantou
 * documents relative as the default, but its core leaves Taffy's default
 * (static), so `right`/`bottom` resolve against the window without it.
 * Workaround for dunkbing/mantou#1.
 */
export function ScrollThumb(props: { scroll: Scroll }) {
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
