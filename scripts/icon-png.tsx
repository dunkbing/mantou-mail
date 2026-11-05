// Renders assets/icon.svg to PNGs (Mantou draws the SVG, headless), for Linux
// packages: bun --preload mantou-ui/preload scripts/icon-png.tsx [out dir] [sizes…]
import { Image, View, mount } from "mantou-ui";
import { HeadlessCore } from "mantou-ui/headless";
import { encodePng } from "mantou-ui/images";
import { join } from "node:path";

const [dir = "dist/icons", ...sizes] = process.argv.slice(2);
const svg = new Uint8Array(await Bun.file(join(import.meta.dir, "../assets/icon.svg")).arrayBuffer());
for (const size of (sizes.length ? sizes : ["48", "128", "256", "512"]).map(Number)) {
  const h = new HeadlessCore({ width: size, height: size });
  mount(h.ui, () => (
    <View style={{ width: size, height: size }}>
      <Image src={svg} style={{ width: size, height: size }} />
    </View>
  ));
  for (let i = 0; i < 20; i++) (h.step(), await Bun.sleep(5)); // the image decodes off the main thread
  const shot = h.capture();
  // The capture is opaque, on the window's background: around the rounded square, that background becomes
  // transparent, and the anti-aliased edge between the two is unmixed (its colour is the accent's, its
  // alpha how much of it there is, from the blue channel, where the two differ most).
  const px = shot.pixels, bg = px.slice(0, 4), accent = [0x4f, 0x46, 0xe5];
  for (let i = 0; i < px.length; i += 4) {
    const a = Math.max(0, Math.min(1, (px[i + 2] - bg[2]) / (accent[2] - bg[2])));
    if (a >= 0.999) continue;
    px.set([...accent, Math.round(a * 255)], i);
  }
  await Bun.write(join(dir, `${size}.png`), encodePng(shot));
  h.free();
}
