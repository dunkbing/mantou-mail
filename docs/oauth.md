# Signing in with Google and Microsoft

Gmail and Outlook accounts can sign in with Google or Microsoft instead of a password:

- **Google:** Gmail, and Google Workspace addresses on a company's own domain.
- **Microsoft:** Outlook.com, Hotmail and Live, and Microsoft 365 work or school addresses.

The app finds company addresses by their domain's MX records.

The browser opens the provider's sign-in page, which sends it back to a port on this machine (`http://127.0.0.1:<port>`). The app keeps a refresh token in the system keychain and gets short-lived access tokens for IMAP and SMTP (XOAUTH2). It never sees the password. The code is in `src/mail/oauth.ts`.

The app needs an OAuth client from each provider for this. Without one, a Gmail address takes an app password, and the Accounts dialog shows how to get one. Outlook and Microsoft 365 have no fallback: Microsoft no longer accepts passwords from mail apps.

## Google

### Make a client

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. Enable the Gmail API (APIs & Services › Library), so that its scopes are listed.
3. Under Google Auth Platform:
   - **Branding:** an app name and a support email.
   - **Audience:** External, Testing. Add the Gmail addresses that will sign in as test users.
   - **Data access:** add the scope `https://mail.google.com/` (full mail access, which IMAP and SMTP need).
4. Under **Clients**, create a client of type **Desktop app**. Copy its client ID and client secret. A desktop app's secret isn't secret: it ships with the app.

### Limits until Google verifies the app

- **Testing:** only the test users can sign in, up to 100, and Google ends a sign-in after 7 days. The account then shows "Sign in to … again to sync it", and one press of "Sign in with Google" in Accounts picks it up again.
- **Production, unverified:** anyone can sign in after a "Google hasn't verified this app" warning, up to 100 new users.
- **Verified:** `https://mail.google.com/` is a restricted scope, so this takes Google's review and a yearly paid security assessment (CASA).

## Microsoft

### Register the app

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **App registrations › New registration**. You can also use [the Azure portal](https://portal.azure.com/), under Microsoft Entra ID. A free personal Microsoft account works.
2. **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts".
3. Register it, and copy the **Application (client) ID**. There's no secret: the app is a public client and uses PKCE.
4. **Redirect URI:** `http://127.0.0.1`, as a public client (mobile and desktop) URI. Microsoft ignores the port of a loopback address, so any port the app picks matches.
   - The portal's Redirect URIs box may refuse `http://` loopback addresses.
   - If it does, open **Manifest** and add this entry to `replyUrlsWithType` (`replyUrls` in the older manifest format):

     ```json
     { "url": "http://127.0.0.1", "type": "InstalledClient" }
     ```

5. **API permissions › Add a permission › APIs my organization uses › Office 365 Exchange Online › Delegated:** add `IMAP.AccessAsUser.All` and `SMTP.Send`. Also add `offline_access`, `openid` and `email` from Microsoft Graph.

### Limits

- Personal accounts can sign in at once. A company's Microsoft 365 may need its admin to allow the app, until the app is publisher-verified.
- Publisher verification is free with a Microsoft Partner Network ID, and there's no paid assessment.
- Microsoft 365 admins can turn off IMAP or SMTP sign-in for a mailbox. Then sync or sending fails with the server's reason.

## Use them

Run the app with the clients in the environment, either or both:

```bash
MANTOU_MAIL_GOOGLE_CLIENT_ID=… MANTOU_MAIL_GOOGLE_CLIENT_SECRET=… MANTOU_MAIL_MICROSOFT_CLIENT_ID=… bun run dev
```

For a build that people install, put them in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `MICROSOFT_CLIENT_ID` in `src/mail/oauth.ts`. Then type an address in Accounts: Gmail and Outlook addresses get "Sign in with Google" or "Sign in with Microsoft" at once, and company addresses get it as soon as their MX records are in.
