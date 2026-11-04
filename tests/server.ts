// An IMAP server in the test process (hoodiecrow), with Gmail-like folders,
// and a second client to look at what the server has.
import hoodiecrow from "hoodiecrow-imap";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import type { ImapSettings } from "../src/mail/providers";
import type { OAuthProvider } from "../src/mail/oauth";

export interface Mail {
  from: string;
  subject: string;
  body: string;
  date?: string;
  id?: string;
  inReplyTo?: string;
  headers?: string;
  flags?: string[];
  /** The whole message, as sent (then the fields above, but flags, aren't used). */
  raw?: string;
}

export const raw = (m: Mail) =>
  [
    `From: ${m.from}`,
    `To: Test User <testuser@example.com>`,
    `Subject: ${m.subject}`,
    `Message-ID: <${m.id ?? Math.random().toString(36).slice(2)}@example.com>`,
    ...(m.inReplyTo ? [`In-Reply-To: <${m.inReplyTo}@example.com>`, `References: <${m.inReplyTo}@example.com>`] : []),
    `Date: ${m.date ?? "Tue, 03 Nov 2026 09:00:00 +0000"}`,
    ...(m.headers ? [m.headers] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    m.body,
    "",
  ].join("\r\n");

const box = (msgs: Mail[] = []) => ({ messages: msgs.map((m) => ({ raw: m.raw ?? raw(m), flags: m.flags ?? [] })) });

export async function imapServer(folders: { inbox?: Mail[]; archive?: Mail[]; sent?: Mail[]; trash?: Mail[]; drafts?: Mail[] }) {
  const server = hoodiecrow({
    plugins: ["IDLE", "SPECIAL-USE", "MOVE", "UIDPLUS", "ENABLE", "CONDSTORE", "ID", "UNSELECT", "SASL-IR", "XOAUTH2"],
    // The password, or an access token (XOAUTH2) that setAccessToken changes.
    users: { testuser: { password: "testpass", xoauth2: { accessToken: "no token yet", sessionTimeout: 3600_000 } } },
    storage: {
      INBOX: box(folders.inbox),
      "": {
        separator: "/",
        folders: {
          Archive: { "special-use": "\\Archive", ...box(folders.archive) },
          Sent: { "special-use": "\\Sent", ...box(folders.sent) },
          Trash: { "special-use": "\\Trash", ...box(folders.trash) },
          Drafts: { "special-use": "\\Drafts", ...box(folders.drafts) },
        },
      },
    },
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s: import("node:net").Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const settings: ImapSettings = { host: "127.0.0.1", port, secure: false, user: "testuser" };
  const token = { current: "no token yet" };
  const smtp = await smtpServer("testpass", token);
  const inspector = new ImapFlow({ host: "127.0.0.1", port, secure: false, auth: { user: "testuser", pass: "testpass" }, logger: false });
  inspector.on("error", () => {});
  await inspector.connect();
  type Connection = { socket: import("node:net").Socket };
  const connections = (server as unknown as { connections: Set<Connection> }).connections;
  const inspectorConnection = [...connections][0]; // the only connection so far
  return {
    settings,
    /** Mail sent to this server's SMTP side. */
    smtp,
    password: "testpass",
    /** Subjects and flags of a folder's messages, as the server has them. */
    async folder(path: string) {
      // Selected afresh each time: a session that has the folder open hears of others' changes only later.
      if (inspector.mailbox) await inspector.mailboxClose();
      const lock = await inspector.getMailboxLock(path);
      try {
        const out: { subject: string; flags: string[] }[] = [];
        if ((inspector.mailbox as { exists: number }).exists) {
          for await (const m of inspector.fetch("1:*", { envelope: true, flags: true })) out.push({ subject: m.envelope?.subject ?? "", flags: [...(m.flags ?? [])].sort() });
        }
        return out;
      } finally {
        lock.release();
      }
    },
    /** The access token both servers take from now on (XOAUTH2); the one before stops working. */
    setAccessToken(t: string) {
      token.current = t;
      (server as unknown as { users: Record<string, { xoauth2: { accessToken: string } }> }).users.testuser.xoauth2.accessToken = t;
    },
    async deliver(path: string, m: Mail) {
      await inspector.append(path, raw(m), m.flags ?? []);
    },
    async close() {
      await smtp.close();
      await inspector.logout().catch(() => inspector.close());
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
    /** Every connection drops (the server stays up): clients log in again. */
    kick() {
      for (const c of connections) if (c !== inspectorConnection) c.socket.destroy();
    },
    /** The server goes away at once, connections and all (the network went down). */
    async drop() {
      await smtp.close();
      inspector.close();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Waits for a condition (not for a time), stepping a headless core while it waits, if there is one. */
export async function until(cond: () => boolean, what: string, step?: () => void, ms = 5_000) {
  const end = Date.now() + ms;
  for (;;) {
    step?.();
    if (cond()) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

/** An SMTP server in the test process: it checks the password and keeps what it receives. */
export async function smtpServer(password = "testpass", token = { current: "" }) {
  const received: { from: string; to: string[]; raw: string }[] = [];
  const server = new SMTPServer({
    logger: false,
    disabledCommands: ["STARTTLS"],
    authMethods: ["PLAIN", "LOGIN", "XOAUTH2"],
    onAuth(auth, _session, done) {
      const ok = auth.method === "XOAUTH2" ? !!token.current && auth.accessToken === token.current : auth.password === password;
      done(ok ? null : Object.assign(new Error("Invalid credentials"), { responseCode: 535 }), { user: auth.username });
    },
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString() });
        done();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.server.address() as { port: number }).port;
  return {
    settings: { host: "127.0.0.1", port, secure: false, user: "testuser" },
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/**
 * A stand-in for a provider's OAuth server (Google's endpoints): the sign-in
 * page answers at once for `email` (or is refused), the token endpoint checks
 * the PKCE verifier, and every access token it issues goes to `onToken` (the
 * IMAP and SMTP servers' setAccessToken). `browser` is what opens the page.
 */
export function oauthServer(opts: { email: string; onToken: (t: string) => void; expiresIn?: number }) {
  const codes = new Map<string, { challenge: string; redirect: string; clientId: string }>();
  const state = { deny: false, revoked: false, issued: 0, refreshes: 0, lastAuth: null as URLSearchParams | null };
  const issue = () => {
    const t = `access-${++state.issued}`;
    opts.onToken(t);
    return t;
  };
  const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.x`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/auth") {
        const q = (state.lastAuth = u.searchParams);
        const back = new URL(q.get("redirect_uri")!);
        back.searchParams.set("state", q.get("state")!);
        if (state.deny) back.searchParams.set("error", "access_denied");
        else {
          const code = crypto.randomUUID();
          codes.set(code, { challenge: q.get("code_challenge")!, redirect: q.get("redirect_uri")!, clientId: q.get("client_id")! });
          back.searchParams.set("code", code);
        }
        return Response.redirect(back.toString(), 302);
      }
      if (u.pathname === "/token") {
        const f = new URLSearchParams(await req.text());
        const bad = (error: string) => Response.json({ error, error_description: error }, { status: 400 });
        if (f.get("grant_type") === "authorization_code") {
          const c = codes.get(f.get("code") ?? "");
          codes.delete(f.get("code") ?? "");
          const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.get("code_verifier") ?? ""))).toString("base64url");
          if (!c || c.redirect !== f.get("redirect_uri") || c.clientId !== f.get("client_id") || hash !== c.challenge) return bad("invalid_grant");
          state.revoked = false;
          return Response.json({ access_token: issue(), refresh_token: "refresh-1", expires_in: opts.expiresIn ?? 3600, id_token: idToken(opts.email) });
        }
        if (f.get("grant_type") === "refresh_token") {
          state.refreshes++;
          if (state.revoked || f.get("refresh_token") !== "refresh-1") return bad("invalid_grant");
          return Response.json({ access_token: issue(), expires_in: opts.expiresIn ?? 3600 });
        }
        return bad("unsupported_grant_type");
      }
      return new Response("Not found", { status: 404 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const provider: OAuthProvider = { id: "google", name: "Google", authUrl: `${base}/auth`, tokenUrl: `${base}/token`, scopes: ["https://mail.google.com/", "openid", "email"], clientId: "test-client", authParams: { access_type: "offline", prompt: "consent" } };
  return {
    provider,
    state,
    /** A browser: opens the sign-in page and follows it back to the app. */
    async browser(url: string) {
      const res = await fetch(url, { redirect: "manual" });
      await fetch(res.headers.get("location")!);
    },
    close: () => server.stop(true),
  };
}
