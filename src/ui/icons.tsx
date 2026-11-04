// Icons: Lucide's icon font (ISC, assets/fonts/LICENSE-lucide.txt), drawn as
// text with `fontFamily`. assets/fonts/lucide.ttf is a subset with the glyphs
// below and a few more; scripts/subset-icons.py remakes it. Every icon in the
// app goes through <Icon>.
import { readFileSync } from "node:fs";
import { Text, useUi, type Ui } from "mantou-ui";
import fontPath from "../../assets/fonts/lucide.ttf" with { type: "file" };

/** Lucide's code points, by the app's name for each icon (Lucide's name in the comment). */
const GLYPHS = {
  inbox: 0xe0f7,
  inboxes: 0xe369, // mails
  archive: 0xe041,
  trash: 0xe18e, // trash-2
  clock: 0xe087,
  doc: 0xe320, // file-pen-line
  sent: 0xe152, // send
  tag: 0xe17f,
  search: 0xe151,
  plus: 0xe13d,
  person: 0xe468, // user-round
  calendar: 0xe304, // calendar-clock
  paperclip: 0xe12d,
  keyboard: 0xe284,
  starOutline: 0xe176, // star
  reply: 0xe22a,
  forward: 0xe229,
  close: 0xe1b2, // x
  check: 0xe06c,
  download: 0xe0b2,
  open: 0xe0b9, // external-link
  warning: 0xe193, // triangle-alert
} as const;

export type IconName = keyof typeof GLYPHS;

/** The character an icon is drawn with (tests find icons by it). */
export const glyph = (name: IconName) => String.fromCodePoint(GLYPHS[name]);

let font: Uint8Array | null = null;
const registered = new WeakSet<Ui>();

/** Registers the icon font with a Ui's core, once. */
export function registerIconFont(ui: Ui) {
  if (registered.has(ui)) return;
  registered.add(ui);
  ui.registerFont((font ??= new Uint8Array(readFileSync(fontPath))));
}

export function Icon(props: { name: IconName; size?: number; color: string }) {
  registerIconFont(useUi());
  const size = () => props.size ?? 16;
  return (
    <Text style={{ fontFamily: "lucide", fontSize: size(), lineHeight: 1, width: size(), height: size(), flexShrink: 0, color: props.color, textAlign: "center" }}>
      {glyph(props.name)}
    </Text>
  );
}
