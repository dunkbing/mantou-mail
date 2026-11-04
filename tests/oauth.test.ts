// Signing in with a provider (OAuth): the browser flow against a stand-in for
// Google's endpoints, and accounts that sync and send with access tokens
// (XOAUTH2) against the IMAP and SMTP servers in the test process.
import { afterEach, expect, test } from "bun:test";
import { google, oauthFor, signIn } from "../src/mail/oauth";
import { Remote } from "../src/mail/remote";
import { memorySecrets } from "../src/mail/secrets";
import { Store } from "../src/mail/store";
import { createMail, type Mail } from "../src/state";
import { imapServer, oauthServer, until } from "./server";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const EMAIL = "sam.rivera@gmail.com";

test("sign-in: the browser goes to the provider and comes back; PKCE, state and the address are checked", async () => {
  const o = oauthServer({ email: EMAIL, onToken: () => {} });
  cleanup.push(o.close);
  const got = await signIn(o.provider, { loginHint: EMAIL, open: o.browser });
  expect(got).toMatchObject({ email: EMAIL, accessToken: "access-1", refreshToken: "refresh-1" });
  expect(got.expiresAt).toBeGreaterThan(Date.now() + 3_000_000);
  const q = o.state.lastAuth!;
  expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/); // a port on this machine only
  expect(q.get("code_challenge_method")).toBe("S256");
  expect(q.get("scope")).toBe("https://mail.google.com/ openid email");
  expect(q.get("login_hint")).toBe(EMAIL);
  expect(q.get("access_type")).toBe("offline");
  // The page that brought the browser back is gone with the sign-in.
  await expect(fetch(q.get("redirect_uri")!)).rejects.toThrow();
});

test("sign-in refused, cancelled, or answered for a stale page", async () => {
  const o = oauthServer({ email: EMAIL, onToken: () => {} });
  cleanup.push(o.close);
  o.state.deny = true;
  await expect(signIn(o.provider, { open: o.browser })).rejects.toThrow("You didn't allow Mantou Mail to use your Google mail");
  const stop = new AbortController();
  const waiting = signIn(o.provider, { open: () => stop.abort(), signal: stop.signal }); // the person closes the tab and presses Cancel
  await expect(waiting).rejects.toThrow("Sign-in cancelled");
  let page = "";
  const stale = signIn(o.provider, { open: async (url) => void (page = (await fetch(`${new URL(url).searchParams.get("redirect_uri")}?state=old&code=x`)).status.toString()), timeout: 50 });
  await expect(stale).rejects.toThrow("The sign-in took too long");
  expect(page).toBe("400");
});

test("which addresses sign in with Google, and only with a client id", () => {
  expect(google({})).toBeNull();
  const g = google({ MANTOU_MAIL_GOOGLE_CLIENT_ID: "id", MANTOU_MAIL_GOOGLE_CLIENT_SECRET: "s" })!;
  expect(g).toMatchObject({ clientId: "id", clientSecret: "s", tokenUrl: "https://oauth2.googleapis.com/token" });
  expect(oauthFor("a@gmail.com", { google: g })).toBe(g);
  expect(oauthFor("a@googlemail.com", { google: g })).toBe(g);
  expect(oauthFor("a@fastmail.com", { google: g })).toBeNull();
  expect(oauthFor("a@gmail.com", { google: null })).toBeNull();
});

async function setup(expiresIn?: number) {
  const server = await imapServer({ inbox: [{ from: "Priya Shah <priya@example.com>", subject: "Onboarding review", body: "Thursday?" }] });
  cleanup.push(() => server.close());
  const o = oauthServer({ email: EMAIL, onToken: (t) => server.setAccessToken(t), expiresIn });
  cleanup.push(o.close);
  const store = new Store(":memory:");
  cleanup.push(() => store.close());
  const secrets = memorySecrets();
  const remote = new Remote(store, secrets, { oauth: { google: o.provider }, openUrl: o.browser, undoSend: 10, retry: 10 });
  cleanup.push(() => remote.stop());
  const mail: Mail = createMail([], { accounts: [], onChange: remote.onChange });
  await remote.attach(mail);
  const add = () => remote.signInAndAdd(EMAIL, { imap: server.settings, smtp: server.smtp.settings });
  return { server, o, remote, mail, secrets, add };
}

test("an account signed in with Google syncs and sends with access tokens; the refresh token is kept, not a password", async () => {
  const { server, remote, mail, secrets, add } = await setup();
  const a = await add();
  expect(a).toMatchObject({ id: EMAIL, email: EMAIL, oauth: "google" });
  expect(await secrets.get(EMAIL)).toBe("refresh-1");
  await remote.syncOf(a.id)!.firstSync;
  expect(mail.list().map((m) => m.subject)).toEqual(["Onboarding review"]);
  mail.compose();
  mail.editDraft({ to: "priya@example.com", subject: "Thursday", body: "Yes." });
  mail.send();
  await until(() => server.smtp.received.length === 1, "the message over SMTP (XOAUTH2)");
});

test("an access token that runs out is refreshed before logging in again", async () => {
  const { server, o, remote, add } = await setup(30); // tokens last 30 s, under the minute the app keeps in hand
  const a = await add();
  await remote.syncOf(a.id)!.firstSync;
  const before = o.state.refreshes; // a token with under a minute left isn't used: it's refreshed first
  server.kick();
  await until(() => o.state.refreshes > before && remote.statuses()[a.id]?.state === "ready", "a refresh and a new login");
  expect(o.state.issued).toBeGreaterThanOrEqual(2);
});

test("access taken back: the account asks to sign in again, and signing in again picks it up", async () => {
  const { server, o, remote, add } = await setup();
  const a = await add();
  await remote.syncOf(a.id)!.firstSync;
  o.state.revoked = true;
  server.setAccessToken("someone else's"); // the server won't take the app's token any more
  server.kick();
  await until(() => remote.statuses()[a.id]?.state === "needs-password", "the account to ask for a sign-in");
  expect(remote.statuses()[a.id]?.detail).toBe(`Sign in to ${EMAIL} again to sync it`);
  await add();
  await until(() => remote.statuses()[a.id]?.state === "ready", "the sync to pick up");
});

test("signing in as another account than the one typed is refused", async () => {
  const { remote, add } = await setup();
  await expect(remote.signInAndAdd("someone.else@gmail.com")).rejects.toThrow(`You signed in as ${EMAIL}, not someone.else@gmail.com`);
  expect(remote.accounts()).toEqual([]);
  await add();
});
