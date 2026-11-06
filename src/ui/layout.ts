// How wide the message list is: dragged by the handle between it and the reader, kept between runs.
import { createSignal } from "mantou-ui";

export const LIST_WIDTH = { min: 280, max: 640, default: 400 };
const clamp = (n: number) => Math.round(Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, n)));

const [width, setWidth] = createSignal(LIST_WIDTH.default);
export const listWidth = width;
let saved: ((n: number) => void) | undefined;

/** Starts from a saved width, and reports each change once the drag ends. */
export function restoreListWidth(initial: number | undefined, save?: (n: number) => void) {
  setWidth(initial === undefined || Number.isNaN(initial) ? LIST_WIDTH.default : clamp(initial));
  saved = save;
}
export const dragListWidth = (n: number) => setWidth(clamp(n));
export const endListDrag = () => saved?.(width());
