// Linux packages: `bun run package:linux [version]` makes, in dist/:
//   mantou-mail-<version>-linux-<arch>.tar.gz  the app, its icon and .desktop entry, and install.sh
//                                             (into ~/.local, or PREFIX=/usr/local), with uninstall.sh
//   mantou-mail_<version>_<arch>.deb          the same in /opt/mantou-mail, for apt and dpkg (needs dpkg-deb)
// Workaround for dunkbing/mantou#81: `mantou package` makes macOS bundles only, so this does the Linux part.
import { $ } from "bun";
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = await Bun.file(join(root, "package.json")).json();
const version = process.argv[2] ?? (pkg.version === "0.0.0" ? `0.0.0+${new Date().toISOString().slice(0, 10).replaceAll("-", "")}` : pkg.version);
const arch = process.arch === "arm64" ? "arm64" : "x64";
const debArch = arch === "arm64" ? "arm64" : "amd64";
const dist = join(root, "dist");
const work = join(dist, "linux");
const SIZES = [48, 64, 128, 256, 512];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// The executable (Bun and the app) and Mantou's core beside it.
const app = join(work, "app");
await $`bunx mantou build src/main.tsx --out ${app} --name mantou-mail`.cwd(root);
rmSync(join(app, ".gen"), { recursive: true, force: true });
// The icon, drawn by Mantou from assets/icon.svg.
const icons = join(work, "icons");
await $`bun --preload mantou-ui/preload scripts/icon-png.tsx ${icons} ${SIZES.map(String)}`.cwd(root);

const desktop = (exec: string) => `[Desktop Entry]
Type=Application
Name=Mantou Mail
GenericName=Mail
Comment=Read, write and organise your email
Exec=${exec}
Icon=mantou-mail
Terminal=false
Categories=Network;Email;
Keywords=mail;email;imap;inbox;
StartupNotify=true
StartupWMClass=mantou-mail
`;

/** The files a package installs, under `share` (applications and icons). */
function share(to: string, exec: string) {
  mkdirSync(join(to, "applications"), { recursive: true });
  writeFileSync(join(to, "applications", "mantou-mail.desktop"), desktop(exec));
  for (const s of SIZES) {
    const dir = join(to, "icons", "hicolor", `${s}x${s}`, "apps");
    mkdirSync(dir, { recursive: true });
    cpSync(join(icons, `${s}.png`), join(dir, "mantou-mail.png"));
  }
  const svg = join(to, "icons", "hicolor", "scalable", "apps");
  mkdirSync(svg, { recursive: true });
  cpSync(join(root, "assets", "icon.svg"), join(svg, "mantou-mail.svg"));
}

// ---------------------------------------------------------------- .tar.gz

const name = `mantou-mail-${version}-linux-${arch}`;
const tree = join(work, name);
cpSync(app, join(tree, "lib"), { recursive: true });
share(join(tree, "share"), "mantou-mail");
const script = (path: string, body: string) => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};
script(join(tree, "install.sh"), `#!/bin/sh
# Installs Mantou Mail for this user (or PREFIX=/usr/local, as root, for everyone).
set -e
cd "$(dirname "$0")"
PREFIX="\${PREFIX:-$HOME/.local}"
mkdir -p "$PREFIX/lib/mantou-mail" "$PREFIX/bin" "$PREFIX/share"
cp -r lib/. "$PREFIX/lib/mantou-mail/"
printf '#!/bin/sh\\nexec "%s/lib/mantou-mail/mantou-mail" "$@"\\n' "$PREFIX" > "$PREFIX/bin/mantou-mail"
chmod 755 "$PREFIX/bin/mantou-mail"
cp -r share/. "$PREFIX/share/"
sed -i "s|^Exec=.*|Exec=$PREFIX/bin/mantou-mail|" "$PREFIX/share/applications/mantou-mail.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database -q "$PREFIX/share/applications" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" || true
echo "Mantou Mail is installed: run mantou-mail, or find it in your applications."
case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) echo "($PREFIX/bin isn't on your PATH: add it, or use the applications menu.)" ;; esac
`);
script(join(tree, "uninstall.sh"), `#!/bin/sh
# Removes what install.sh put in PREFIX (your mail and settings stay, in ~/.local/share/mantou-mail).
set -e
PREFIX="\${PREFIX:-$HOME/.local}"
rm -rf "$PREFIX/lib/mantou-mail" "$PREFIX/bin/mantou-mail" "$PREFIX/share/applications/mantou-mail.desktop"
find "$PREFIX/share/icons/hicolor" -name 'mantou-mail.*' -delete 2>/dev/null || true
echo "Mantou Mail is removed."
`);
writeFileSync(join(tree, "README.txt"), `Mantou Mail ${version} for Linux (${arch})

Install for yourself:            ./install.sh
Or for everyone (as root):      PREFIX=/usr/local ./install.sh
Or run it from here:            ./lib/mantou-mail

It needs Vulkan or OpenGL drivers (Mesa's are fine) and libxkbcommon-x11.
For file dialogs: zenity, or the desktop portal (GNOME and KDE have one).
`);
await $`tar -czf ${join(dist, `${name}.tar.gz`)} -C ${work} ${name}`;

// ---------------------------------------------------------------- .deb

if (Bun.which("dpkg-deb")) {
  const deb = join(work, "deb");
  cpSync(app, join(deb, "opt", "mantou-mail"), { recursive: true });
  mkdirSync(join(deb, "usr", "bin"), { recursive: true });
  script(join(deb, "usr", "bin", "mantou-mail"), `#!/bin/sh\nexec /opt/mantou-mail/mantou-mail "$@"\n`);
  share(join(deb, "usr", "share"), "/usr/bin/mantou-mail");
  mkdirSync(join(deb, "DEBIAN"), { recursive: true });
  const kb = Math.ceil(Number((await $`du -sk ${deb}`.text()).split("\t")[0]));
  writeFileSync(join(deb, "DEBIAN", "control"), `Package: mantou-mail
Version: ${version.replace(/[^0-9A-Za-z.+~-]/g, "")}
Architecture: ${debArch}
Maintainer: binh.buidang <dangbinh4869@gmail.com>
Installed-Size: ${kb}
Depends: libc6 (>= 2.35), libxkbcommon-x11-0, libvulkan1 | libgl1
Recommends: mesa-vulkan-drivers, zenity | xdg-desktop-portal
Section: mail
Priority: optional
Homepage: https://github.com/dunkbing/mantou-mail
Description: Desktop mail client
 IMAP and SMTP accounts with a local copy that works offline, Gmail and
 Outlook sign-in, conversations, labels, snooze, search, Send Later and
 Undo Send. Built with Mantou (Bun and TypeScript, drawn on the GPU).
`);
  await $`dpkg-deb --root-owner-group --build ${deb} ${join(dist, `mantou-mail_${version}_${debArch}.deb`)}`.quiet();
}

console.log((await $`ls -la ${dist}`.text()).split("\n").filter((l) => /mantou-mail[-_]/.test(l)).join("\n"));
