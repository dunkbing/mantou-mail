#!/usr/bin/env python3
# Remakes assets/fonts/lucide.ttf: Lucide's icon font cut down to the icons
# below. Needs fontTools (pip install fonttools) and the lucide-static package:
#   npm pack lucide-static && tar xzf lucide-static-*.tgz
#   python3 scripts/subset-icons.py package
# Then copy the code points for any new icon into GLYPHS in src/ui/icons.tsx.
import json, subprocess, sys

NAMES = [
    # In use (src/ui/icons.tsx)
    "inbox", "mails", "archive", "trash-2", "clock", "file-pen-line", "send", "tag", "search", "plus",
    "user-round", "calendar-clock", "paperclip", "keyboard", "star", "reply", "forward", "x", "check",
    "download", "external-link", "triangle-alert",
    # Spare, for what's next
    "calendar", "folder-open", "mail", "pencil", "undo-2", "alarm-clock", "settings", "refresh-cw", "mail-open",
    "reply-all", "square-pen", "circle-alert", "info", "file", "save", "chevron-down", "chevron-right", "ellipsis",
    "log-out", "sun", "moon", "sparkles", "pin", "flag", "bell", "bell-off", "eye", "eye-off", "copy", "printer",
    "link", "image", "lock",
]

pkg = sys.argv[1] if len(sys.argv) > 1 else "package"
points = json.load(open(f"{pkg}/font/codepoints.json"))
for n in NAMES:
    print(f"{n}: 0x{points[n]:04x}")
unicodes = ",".join(f"U+{points[n]:04X}" for n in NAMES)
subprocess.run(["pyftsubset", f"{pkg}/font/lucide.ttf", f"--unicodes={unicodes}", "--output-file=assets/fonts/lucide.ttf",
                "--no-hinting", "--layout-features=", "--name-IDs=*"], check=True)
subprocess.run(["cp", f"{pkg}/LICENSE", "assets/fonts/LICENSE-lucide.txt"], check=True)
