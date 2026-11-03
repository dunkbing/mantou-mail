// Icons. Workaround for dunkbing/mantou#8 (vector images or app fonts):
// Mantou can't draw SVG or use an icon font yet, so each icon is drawn from
// what it can draw, on a 16-unit grid: rounded rects and circles (outlined with
// a border, or filled) and short straight strokes, plus Inter's own glyphs
// where it has the symbol (★, ↩). Diagonals are steps of small squares. Every
// icon in the app goes through <Icon>, so moving to real icons is this file.
import { For, Text, View } from "mantou-ui";

/** A shape on the 16-unit grid: x, y, width, height; `o` outlines it, `r` rounds it. */
type Part = { x: number; y: number; w: number; h: number; r?: number; o?: boolean };
const S = 1.5; // stroke width

const line = (x: number, y: number, w: number, h: number): Part => ({ x, y, w, h, r: S / 2 });
const box = (x: number, y: number, w: number, h: number, r = 2): Part => ({ x, y, w, h, r, o: true });
const dot = (x: number, y: number, d = S): Part => ({ x, y, w: d, h: d, r: d / 2 });
const ring = (x: number, y: number, d: number): Part => ({ x, y, w: d, h: d, r: d / 2, o: true });
/** A diagonal from (x, y), `n` steps of a small square, each `dx`, `dy` on. */
const steps = (x: number, y: number, n: number, dx: number, dy: number, d = 1.75): Part[] => Array.from({ length: n }, (_, i) => ({ x: x + i * dx, y: y + i * dy, w: d, h: d, r: d / 3 }));

const SHAPES = {
  inbox: [box(1, 2.5, 14, 11), line(1, 8.5, 4.5, S), line(10.5, 8.5, 4.5, S), line(5.25, 8.5, S, 2.5), line(9.25, 8.5, S, 2.5), line(5.25, 10.25, 5.5, S)],
  inboxes: [box(1, 4.5, 14, 10), line(3, 1.75, 10, S), line(1, 10, 4.5, S), line(10.5, 10, 4.5, S), line(5.25, 10, 5.5, S)],
  archive: [box(1, 2, 14, 4, 1), box(2, 5.5, 12, 8.5, 1.5), line(6, 8.25, 4, S)],
  trash: [line(1.5, 3.5, 13, S), box(5.5, 1, 5, 3.5, 1), box(3, 4.25, 10, 10.25, 1.5), line(6, 7, S, 5), line(8.5, 7, S, 5)],
  clock: [ring(1, 1, 14), line(7.25, 4, S, 4.75), line(7.25, 7.25, 3.75, S)],
  doc: [box(2.5, 1, 11, 14, 1.5), line(5, 4.5, 6, S), line(5, 7.5, 6, S), line(5, 10.5, 3.5, S)],
  sent: [line(1, 9, S, 5.5), line(13.5, 9, S, 5.5), line(1, 13, 14, S), line(7.25, 1.5, S, 8.5), ...steps(5.6, 3.1, 2, -1.5, 1.5), ...steps(8.65, 3.1, 2, 1.5, 1.5)],
  tag: [box(1, 3.5, 13.5, 9, 2.5), dot(3.75, 7.25, 2)],
  search: [ring(1, 1, 10.5), ...steps(9, 9, 6, 0.95, 0.95, 2.4)],
  plus: [line(7.25, 2, S, 12), line(2, 7.25, 12, S)],
  person: [ring(5, 1, 6), box(2, 9, 12, 6.5, 3.25)],
  keyboard: [box(1, 3.5, 14, 9.5, 2), dot(3.5, 6, 1.75), dot(6, 6, 1.75), dot(8.5, 6, 1.75), dot(11, 6, 1.75), line(4.5, 9.25, 7, S)],
} satisfies Record<string, Part[]>;

/** Symbols the bundled Inter has, drawn as text (they're the same on every platform). */
const GLYPHS = { star: "★", starOutline: "☆", reply: "↩", close: "×", check: "✓" } as const;

export type IconName = keyof typeof SHAPES | keyof typeof GLYPHS;

export function Icon(props: { name: IconName; size?: number; color: string }) {
  const size = () => props.size ?? 16;
  const k = () => size() / 16;
  return (
    <View style={{ position: "relative", width: size(), height: size(), flexShrink: 0, justifyContent: "center" }}>
      {props.name in GLYPHS ? (
        <Text style={{ fontSize: size() * 1.05, lineHeight: 1, color: props.color, textAlign: "center" }}>{GLYPHS[props.name as keyof typeof GLYPHS]}</Text>
      ) : (
        <For each={SHAPES[props.name as keyof typeof SHAPES]}>
          {(p) => (
            <View
              style={{
                position: "absolute",
                left: p.x * k(),
                top: p.y * k(),
                width: p.w * k(),
                height: p.h * k(),
                borderRadius: (p.r ?? 0) * k(),
                ...(p.o ? { borderWidth: S * k(), borderColor: props.color } : { backgroundColor: props.color }),
              }}
            />
          )}
        </For>
      )}
    </View>
  );
}
