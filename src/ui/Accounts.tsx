// The Accounts dialog: the real accounts and how their sync is going, and the
// form that adds one (or asks for a password again).
import { For, Input, Show, Text, View, createSignal, onMount, type JSX, type Node } from "mantou-ui";
import type { Remote } from "../mail/remote";
import { guessSettings, guessSmtp, providerFor, type ImapSettings, type SmtpSettings } from "../mail/providers";
import type { AccountConfig } from "../mail/store";
import type { SyncState } from "../mail/imap";
import { C, caption, field, hline, small } from "./theme";
import { Avatar, Kbd, SendButton, TextButton } from "./common";

export const STATE_COLOR: Record<SyncState, string> = {
  connecting: "#f59e0b",
  syncing: "#f59e0b",
  ready: "#10b981",
  offline: "#9ca3af",
  error: "#ef4444",
  "needs-password": "#ef4444",
};

function Field(props: { label: string; children: JSX.Element; note?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 40, gap: 12 }}>
      <Text style={{ width: 96, flexShrink: 0, fontSize: 13, color: C.muted }}>{props.label}</Text>
      {props.children}
      <Show when={props.note}>
        <Text style={[small, { flexShrink: 0 }]}>{props.note}</Text>
      </Show>
    </View>
  );
}

const box = (focused: boolean) => ({ height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 7, borderWidth: 1, borderColor: focused ? C.accent : C.line, backgroundColor: "#ffffff" });

/** A text field with a border that shows the focus. */
function TextField(props: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number; autoFocus?: boolean; ref?: (n: Node) => void; onSubmit?: () => void; readOnly?: boolean; secure?: boolean }) {
  const [focused, setFocused] = createSignal(false);
  return (
    <Input
      ref={props.ref}
      value={props.value}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      readOnly={props.readOnly}
      secure={props.secure}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[field, box(focused()), props.width ? { width: props.width, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0 }, props.readOnly ? { color: C.secondary } : {}]}
    />
  );
}

function AccountRow(props: { remote: Remote; account: AccountConfig; onReconnect: () => void }) {
  const status = () => props.remote.statuses()[props.account.id];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 10 }}>
      <Avatar name={props.account.sender} size={32} />
      <View style={{ flexGrow: 1, flexShrink: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: 600, color: C.text, maxLines: 1 }}>{props.account.email}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, flexShrink: 0, backgroundColor: STATE_COLOR[status()?.state ?? "offline"] }} />
          <Text style={[small, { flexShrink: 1, maxLines: 1 }]}>{status()?.detail ?? "Not connected"}</Text>
        </View>
      </View>
      <Show when={status()?.state === "needs-password"}>
        <TextButton label="Enter password" onPress={props.onReconnect} />
      </Show>
      <TextButton label="Remove" onPress={() => void props.remote.removeAccount(props.account.id)} />
    </View>
  );
}

export function Accounts(props: { remote: Remote; onClose: () => void }) {
  const r = props.remote;
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [sender, setSender] = createSignal("");
  const [server, setServer] = createSignal<ImapSettings>({ host: "", port: 993, secure: true, user: "" });
  const [smtp, setSmtp] = createSignal<SmtpSettings>({ host: "", port: 465, secure: true, user: "" });
  /** The server settings were typed, not guessed: the email no longer changes them. */
  const [custom, setCustom] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [keychain, setKeychain] = createSignal(true);
  let passwordInput: Node | undefined;
  onMount(() => void r.secrets.persistent().then(setKeychain));

  const editEmail = (v: string) => {
    setEmail(v);
    setError("");
    if (!custom()) {
      setServer(guessSettings(v));
      setSmtp(guessSmtp(v));
    }
  };
  const editServer = (p: Partial<ImapSettings>) => {
    setCustom(true);
    setError("");
    setServer({ ...server(), ...p, ...(p.port !== undefined ? { secure: p.port === 993 } : {}) });
    if (p.user !== undefined) setSmtp({ ...smtp(), user: p.user }); // the same login, as almost everywhere
  };
  const editSmtp = (p: Partial<SmtpSettings>) => {
    setCustom(true);
    setError("");
    setSmtp({ ...smtp(), ...p, ...(p.port !== undefined ? { secure: p.port === 465 } : {}) });
  };
  const reconnect = (a: AccountConfig) => {
    setReconnecting(a.id);
    setEmail(a.email);
    setSender(a.sender);
    setServer(a.imap);
    setSmtp(a.smtp ?? { ...guessSmtp(a.email), user: a.imap.user });
    setCustom(true);
    setPassword("");
    setError("");
    passwordInput?.focus();
  };
  const connect = async () => {
    if (busy()) return;
    if (!/@/.test(email())) return setError("Enter your email address");
    if (!password()) return setError("Enter the password (or app password)");
    if (!server().host) return setError("Enter the IMAP server");
    if (!smtp().host) return setError("Enter the SMTP server");
    setBusy(true);
    setError("");
    try {
      await r.addAccount({ email: email(), password: password(), imap: server(), smtp: smtp(), sender: sender() });
      setEmail("");
      setPassword("");
      setSender("");
      setServer({ host: "", port: 993, secure: true, user: "" });
      setSmtp({ host: "", port: 465, secure: true, user: "" });
      setCustom(false);
      setReconnecting(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const accounts = r.list;

  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: C.backdrop, justifyContent: "center", alignItems: "center" }} onPress={props.onClose}>
      <View focusScope style={{ width: 640, borderRadius: 12, overflow: "hidden", backgroundColor: "#ffffff" }} onPress={(e) => e.stopPropagation()}>
        <View style={{ flexDirection: "row", alignItems: "center", height: 48, paddingLeft: 24, paddingRight: 16, backgroundColor: "#fafafa" }}>
          <Text style={{ flexGrow: 1, fontSize: 15, fontWeight: 600, color: C.text }}>Accounts</Text>
          <Kbd text="Esc" />
        </View>
        <View style={hline} />
        <Show when={accounts().length > 0}>
          <View style={{ paddingLeft: 24, paddingRight: 16, paddingTop: 6, paddingBottom: 6 }}>
            <For each={accounts()}>{(a) => <AccountRow remote={r} account={a} onReconnect={() => reconnect(a)} />}</For>
          </View>
          <View style={hline} />
        </Show>
        <View style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 18, paddingBottom: 8, gap: 4 }}>
          <Text style={caption}>{reconnecting() ? `PASSWORD FOR ${reconnecting()!.toUpperCase()}` : "ADD AN IMAP ACCOUNT"}</Text>
          <Text style={[small, { lineHeight: 1.5, paddingBottom: 8 }]}>
            {providerFor(email())?.passwordHint ?? "Gmail, Outlook, iCloud, Fastmail, Yahoo and most other providers work over IMAP; many need an app password for it."}
          </Text>
          <Field label="Email">
            <TextField autoFocus value={email()} onChange={editEmail} placeholder="you@example.com" readOnly={!!reconnecting()} onSubmit={() => passwordInput?.focus()} />
          </Field>
          <Field label="Password">
            <TextField secure ref={(n) => (passwordInput = n)} value={password()} onChange={(v) => (setPassword(v), setError(""))} placeholder="Password or app password" onSubmit={() => void connect()} />
          </Field>
          <Show when={!reconnecting()}>
            <Field label="Your name">
              <TextField value={sender()} onChange={setSender} placeholder="As it appears on mail you send" />
            </Field>
          </Show>
          <Field label="IMAP server" note={server().secure ? "TLS" : "STARTTLS"}>
            <TextField value={server().host} onChange={(host) => editServer({ host })} placeholder="imap.example.com" />
            <TextField width={72} value={String(server().port)} onChange={(v) => editServer({ port: Number(v.replace(/\D/g, "")) || 0 })} />
          </Field>
          <Field label="SMTP server" note={smtp().secure ? "TLS" : "STARTTLS"}>
            <TextField value={smtp().host} onChange={(host) => editSmtp({ host })} placeholder="smtp.example.com" />
            <TextField width={72} value={String(smtp().port)} onChange={(v) => editSmtp({ port: Number(v.replace(/\D/g, "")) || 0 })} />
          </Field>
          <Field label="Username">
            <TextField value={server().user} onChange={(user) => editServer({ user })} placeholder="Usually your email address" />
          </Field>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, paddingLeft: 24, paddingRight: 24, paddingBottom: 8 }}>
          <SendButton label={busy() ? "Connecting…" : "Connect"} keys="Enter" onPress={() => void connect()} />
          <Show when={reconnecting()}>
            <TextButton label="Cancel" onPress={() => (setReconnecting(null), setEmail(""), setPassword(""), setCustom(false))} />
          </Show>
          <Show when={error()} fallback={<Text style={[small, { flexShrink: 1, lineHeight: 1.4 }]}>{keychain() ? "The password is kept in the system keychain." : "There's no system keychain here: the password is kept until you quit."}</Text>}>
            <Text style={{ flexShrink: 1, fontSize: 12, lineHeight: 1.4, color: "#b91c1c" }}>{error()}</Text>
          </Show>
        </View>
      </View>
    </View>
  );
}
