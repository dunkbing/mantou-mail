// Signing in with a provider (OAuth 2.0) instead of a password: Gmail now, and
// Outlook next, which no longer takes passwords at all. The flow is the one for
// desktop apps (RFC 8252): the system's browser opens the provider's sign-in
// page, which sends the browser back to a port on this machine with a code;
// the code and a secret made for this sign-in (PKCE) buy a refresh token, kept
// in the keychain like a password, and short-lived access tokens, which IMAP
// and SMTP take instead of the password (XOAUTH2).
import { openWithSystem } from "./files";

export type OAuthProviderId = "google";

export interface OAuthProvider {
  id: OAuthProviderId;
  /** "Google", as on the button. */
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  /** Google's desktop clients have one; it isn't secret (it ships with the app). */
  clientSecret?: string;
  /** More parameters for the sign-in page. */
  authParams?: Record<string, string>;
}

/**
 * The app's OAuth clients, as registered with each provider (docs/oauth.md).
 * Desktop clients' ids ship with the app; MANTOU_MAIL_GOOGLE_CLIENT_ID and
 * MANTOU_MAIL_GOOGLE_CLIENT_SECRET override them (for your own client).
 */
const GOOGLE_CLIENT_ID = "";
const GOOGLE_CLIENT_SECRET = "";

/** Google's settings, or null when the app has no client id for it. */
export function google(env: Record<string, string | undefined> = process.env): OAuthProvider | null {
  const clientId = env.MANTOU_MAIL_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  return {
    id: "google",
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // Full mail access is what IMAP and SMTP need; openid and email say whose account it is.
    scopes: ["https://mail.google.com/", "openid", "email"],
    clientId,
    clientSecret: env.MANTOU_MAIL_GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET || undefined,
    // A refresh token, asked for again on every sign-in (Google only sends one on consent).
    authParams: { access_type: "offline", prompt: "consent" },
  };
}

/** The provider an address signs in with, if the app has one for it. */
export function oauthFor(email: string, providers: { google?: OAuthProvider | null } = { google: google() }): OAuthProvider | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return providers.google ?? null;
  return null;
}

export interface Tokens {
  accessToken: string;
  /** When the access token stops working (ms since the epoch). */
  expiresAt: number;
  /** Present on sign-in; a refresh may send a new one. */
  refreshToken?: string;
}

export interface SignedIn extends Tokens {
  refreshToken: string;
  /** The account's address, as the provider has it. */
  email: string;
}

/** Why a sign-in or refresh failed; `revoked` means signing in again is the only fix. */
export class OAuthError extends Error {
  constructor(message: string, readonly revoked = false) {
    super(message);
  }
}

const base64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const random = (n = 32) => base64url(crypto.getRandomValues(new Uint8Array(n)));

/** The email in an ID token (it comes straight from the token endpoint over TLS, so it isn't verified again here). */
function emailOf(idToken: string | undefined): string | undefined {
  try {
    return JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString()).email;
  } catch {
    return undefined;
  }
}

async function tokenRequest(p: OAuthProvider, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ client_id: p.clientId, ...(p.clientSecret ? { client_secret: p.clientSecret } : {}), ...params });
  let res: Response;
  try {
    res = await fetch(p.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  } catch (e) {
    throw new OAuthError(`Can't reach ${p.name}: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = String(json.error ?? res.status);
    throw new OAuthError(`${p.name} said no: ${json.error_description ?? error}`, error === "invalid_grant");
  }
  return json;
}

const tokensOf = (json: Record<string, unknown>, now = Date.now()): Tokens => ({
  accessToken: String(json.access_token),
  expiresAt: now + Number(json.expires_in ?? 3600) * 1000,
  ...(json.refresh_token ? { refreshToken: String(json.refresh_token) } : {}),
});

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;color:#111827"><h1 style="font-size:22px">${title}</h1><p>${text}</p>`;

/**
 * Signs in: opens the provider's page in the system's browser and waits for it
 * to come back to this machine. Resolves to the tokens and the address signed
 * in with; `signal` cancels it (and so does `timeout`).
 */
export async function signIn(
  p: OAuthProvider,
  opts: { loginHint?: string; open?: (url: string) => void | Promise<void>; signal?: AbortSignal; timeout?: number } = {},
): Promise<SignedIn> {
  const verifier = random(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(16);
  let settle!: { ok: (code: string) => void; fail: (e: Error) => void };
  const code = new Promise<string>((ok, fail) => (settle = { ok, fail }));
  code.catch(() => {}); // awaited below; this only keeps an early cancel from counting as unhandled
  // The browser comes back here: a port on this machine only (RFC 8252 section 7.3).
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== "/") return new Response("Not found", { status: 404 });
      if (u.searchParams.get("state") !== state) return new Response(PAGE("That didn't work", "This sign-in page is out of date. Start again from Mantou Mail."), { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
      const error = u.searchParams.get("error");
      if (error) {
        settle.fail(new OAuthError(error === "access_denied" ? `You didn't allow Mantou Mail to use your ${p.name} mail` : `${p.name} said no: ${error}`));
        return new Response(PAGE("Not signed in", "You can close this tab and go back to Mantou Mail."), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      settle.ok(u.searchParams.get("code") ?? "");
      return new Response(PAGE("Signed in", "You can close this tab and go back to Mantou Mail."), { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}/`;
  const url = new URL(p.authUrl);
  for (const [k, v] of Object.entries({
    client_id: p.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: p.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    ...p.authParams,
  })) url.searchParams.set(k, v);
  const timer = setTimeout(() => settle.fail(new OAuthError("The sign-in took too long; try again")), opts.timeout ?? 5 * 60_000);
  const abort = () => settle.fail(new OAuthError("Sign-in cancelled"));
  opts.signal?.addEventListener("abort", abort);
  try {
    // Workaround for dunkbing/mantou#21 (opening a URL): the system's opener, run from Bun.
    await (opts.open ?? openWithSystem)(url.toString());
    const got = await code;
    const json = await tokenRequest(p, { grant_type: "authorization_code", code: got, redirect_uri: redirectUri, code_verifier: verifier });
    const tokens = tokensOf(json);
    if (!tokens.refreshToken) throw new OAuthError(`${p.name} didn't allow offline access; try again`);
    const email = emailOf(json.id_token as string | undefined) ?? opts.loginHint;
    if (!email) throw new OAuthError(`${p.name} didn't say which account you signed in with`);
    return { ...tokens, refreshToken: tokens.refreshToken, email };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abort);
    server.stop(true);
  }
}

/** A new access token from the refresh token. Throws OAuthError (revoked: sign in again). */
export async function refresh(p: OAuthProvider, refreshToken: string): Promise<Tokens> {
  return tokensOf(await tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken }));
}
