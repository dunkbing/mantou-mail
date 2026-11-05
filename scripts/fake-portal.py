# A stand-in for the XDG desktop portal's Settings, to check on Linux that the app follows
# the desktop's light or dark preference (src/ui/desktopScheme.ts) without a desktop:
#   dbus-run-session -- sh -c 'python3 scripts/fake-portal.py & sleep 1; bun run dev'
# It answers color-scheme 1 (dark), then 2 (light) after FLIP seconds (default 8). Needs PyGObject.
import os, sys
from gi.repository import Gio, GLib
XML = """<node><interface name='org.freedesktop.portal.Settings'>
<method name='Read'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='v' direction='out'/></method>
<signal name='SettingChanged'><arg type='s'/><arg type='s'/><arg type='v'/></signal>
</interface></node>"""
state = {"scheme": 1}
def call(conn, sender, path, iface, method, params, inv):
    ns, key = params.unpack()
    if (ns, key) == ("org.freedesktop.appearance", "color-scheme"):
        inv.return_value(GLib.Variant("(v)", (GLib.Variant("v", GLib.Variant("u", state["scheme"])),)))
    else:
        inv.return_dbus_error("org.freedesktop.portal.Error.NotFound", "no such setting")
def acquired(conn, name):
    info = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
    conn.register_object("/org/freedesktop/portal/desktop", info, call, None, None)
    def flip():
        state["scheme"] = 2
        conn.emit_signal(None, "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Settings", "SettingChanged",
                         GLib.Variant("(ssv)", ("org.freedesktop.appearance", "color-scheme", GLib.Variant("u", 2))))
        print("flipped", flush=True)
        return False
    GLib.timeout_add_seconds(int(os.environ.get("FLIP", "8")), flip)
    print("portal up", flush=True)
Gio.bus_own_name(Gio.BusType.SESSION, "org.freedesktop.portal.Desktop", 0, acquired, None, None)
GLib.MainLoop().run()
