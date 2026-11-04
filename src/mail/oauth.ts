// Signing in with a provider (OAuth 2.0) instead of a password: Google (Gmail,
// Google Workspace) and Microsoft (Outlook.com, Microsoft 365, which no longer
// take passwords from mail apps at all). The flow is the one for
// desktop apps (RFC 8252): the system's browser opens the provider's sign-in
// page, which sends the browser back to a port on this machine with a code;
// the code and a secret made for this sign-in (PKCE) buy a refresh token, kept
// in the keychain like a password, and short-lived access tokens, which IMAP
// and SMTP take instead of the password (XOAUTH2).
import { openWithSystem } from "./files";
import type { ImapSettings, SmtpSettings } from "./providers";

export type OAuthProviderId = "google" | "microsoft";

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
  /** The token endpoint wants the scopes again (Microsoft's does). */
  tokenScopes?: boolean;
  /** Its mail servers take no passwords at all, app passwords included (Microsoft's). */
  noPasswords?: boolean;
  /** The provider's mail servers, for an account signed in with it (the login is the address). */
  imap: Omit<ImapSettings, "user">;
  smtp: Omit<SmtpSettings, "user">;
}

/**
 * The app's OAuth clients, as registered with each provider (docs/oauth.md).
 * Desktop clients' ids ship with the app; MANTOU_MAIL_GOOGLE_CLIENT_ID,
 * MANTOU_MAIL_GOOGLE_CLIENT_SECRET and MANTOU_MAIL_MICROSOFT_CLIENT_ID
 * override them (for your own clients).
 */
const GOOGLE_CLIENT_ID = "";
const GOOGLE_CLIENT_SECRET = "";
const MICROSOFT_CLIENT_ID = "";

type Env = Record<string, string | undefined>;

/** Google's settings, or null when the app has no client id for it. */
export function google(env: Env = process.env): OAuthProvider | null {
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
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
  };
}

/**
 * Microsoft's settings (personal accounts and work or school ones: the
 * "common" endpoints), or null when the app has no client id for it. A
 * public client: PKCE, no secret.
 */
export function microsoft(env: Env = process.env): OAuthProvider | null {
  const clientId = env.MANTOU_MAIL_MICROSOFT_CLIENT_ID || MICROSOFT_CLIENT_ID;
  if (!clientId) return null;
  return {
    id: "microsoft",
    name: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // IMAP and SMTP for the signed-in mailbox; offline_access for a refresh token; openid and email say whose it is.
    scopes: ["https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send", "offline_access", "openid", "email"],
    clientId,
    authParams: { prompt: "select_account" },
    tokenScopes: true,
    noPasswords: true,
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  };
}

export type Providers = Partial<Record<OAuthProviderId, OAuthProvider | null>>;

/** The app's providers: those it has a client id for. */
export const appProviders = (env: Env = process.env): Providers => ({ google: google(env), microsoft: microsoft(env) });

const GOOGLE_DOMAINS = /^(gmail|googlemail)\.com$/;
const MICROSOFT_DOMAINS = /^(outlook|hotmail|live|msn)\.[a-z.]+$/;

/** Who hosts a domain's mail, from its MX hosts: Google Workspace and Microsoft 365 are the ones that sign in. */
export function hostOfMx(exchanges: string[]): OAuthProviderId | undefined {
  for (const x of exchanges.map((e) => e.toLowerCase().replace(/\.$/, ""))) {
    if (/(^|\.)(google|googlemail)\.com$/.test(x)) return "google";
    if (/\.mail\.protection\.outlook\.com$/.test(x) || /(^|\.)outlook\.com$/.test(x)) return "microsoft";
  }
  return undefined;
}

/**
 * The provider an address signs in with, if the app has one for it: by its
 * domain (gmail.com, outlook.com…), else by who hosts the domain's mail
 * (`hostedBy`, from its MX records: a company on Google Workspace or Microsoft 365).
 */
export function oauthFor(email: string, providers: Providers = appProviders(), hostedBy?: OAuthProviderId): OAuthProvider | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  const id: OAuthProviderId | undefined = GOOGLE_DOMAINS.test(domain) ? "google" : MICROSOFT_DOMAINS.test(domain) ? "microsoft" : hostedBy;
  return id ? (providers[id] ?? null) : null;
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

/**
 * The address in an ID token (it comes straight from the token endpoint over
 * TLS, so it isn't verified again here): `email`, or Microsoft's
 * `preferred_username` (the sign-in name, an address for mail accounts).
 */
function emailOf(idToken: string | undefined): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString());
    const name = claims.email ?? claims.preferred_username;
    return typeof name === "string" && name.includes("@") ? name : undefined;
  } catch {
    return undefined;
  }
}

async function tokenRequest(p: OAuthProvider, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ client_id: p.clientId, ...(p.clientSecret ? { client_secret: p.clientSecret } : {}), ...(p.tokenScopes ? { scope: p.scopes.join(" ") } : {}), ...params });
  let res: Response;
  try {
    res = await fetch(p.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  } catch (e) {
    throw new OAuthError(`Can't reach ${p.name}: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = String(json.error ?? res.status);
    // invalid_grant: revoked or expired; interaction_required: Microsoft wants the person back (a new policy, a password change).
    throw new OAuthError(`${p.name} said no: ${String(json.error_description ?? error).split(/\r?\n/)[0]}`, error === "invalid_grant" || error === "interaction_required");
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
  // Registered as http://127.0.0.1 (any port: RFC 8252 section 7.3; Microsoft ignores the port of a loopback address too).
  const redirectUri = `http://127.0.0.1:${server.port}`;
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
