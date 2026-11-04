# Signing in with Google

Gmail accounts can sign in with Google instead of an app password. The browser opens Google's sign-in page, and Google sends it back to a port on this machine. The app keeps a refresh token in the system keychain and gets short-lived access tokens for IMAP and SMTP (XOAUTH2). It never sees the password. The code is in `src/mail/oauth.ts`.

The app needs an OAuth client from Google for this. Until it has one, a Gmail address uses an app password, as before.

## Make a client

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. Enable the Gmail API (APIs & Services › Library), so that its scopes are listed.
3. Under Google Auth Platform:
   - **Branding:** an app name and a support email.
   - **Audience:** External, Testing. Add the Gmail addresses that will sign in as test users.
   - **Data access:** add the scope `https://mail.google.com/` (full mail access, which IMAP and SMTP need).
4. Under **Clients**, create a client of type **Desktop app**. Copy its client ID and client secret. A desktop app's secret isn't secret: it ships with the app.

## Use it

Run the app with the client in the environment:

```bash
MANTOU_MAIL_GOOGLE_CLIENT_ID=… MANTOU_MAIL_GOOGLE_CLIENT_SECRET=… bun run dev
```

For a build that people install, put them in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `src/mail/oauth.ts`. Then type a Gmail address in Accounts, and the form offers "Sign in with Google".

## Limits while the client is in Testing

- Only the test users can sign in, up to 100.
- Google lets a Testing client's refresh tokens expire after 7 days. The account then shows "Sign in to … again to sync it", and one press of "Sign in with Google" in Accounts picks it up again.
- Letting anyone sign in means publishing the client. `https://mail.google.com/` is a restricted scope, so publishing takes Google's verification and a yearly security assessment.

## Outlook

Outlook.com and Microsoft 365 no longer accept passwords from mail apps. Signing in with Microsoft is next: the same flow with Microsoft's endpoints (`login.microsoftonline.com`) and an app registered in Microsoft Entra.
