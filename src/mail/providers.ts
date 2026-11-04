// IMAP and SMTP settings for well-known providers, guessed from the
// address's domain. Anything else gets imap.<domain> on 993 and
// smtp.<domain> on 465, which the user can change.

export interface ImapSettings {
  host: string;
  port: number;
  /** TLS from the start (993); otherwise STARTTLS is required, except on this machine. */
  secure: boolean;
  user: string;
}

/** Where mail is sent: TLS from the start on 465, else STARTTLS (required, except on this machine). */
export type SmtpSettings = ImapSettings;

export interface Provider {
  name: string;
  host: string;
  smtp: { host: string; port: number };
  /** What to tell people about passwords (several providers need an app password for IMAP). */
  passwordHint?: string;
}

const PROVIDERS: [RegExp, Provider][] = [
  [/^(gmail|googlemail)\.com$/, { name: "Gmail", host: "imap.gmail.com", smtp: { host: "smtp.gmail.com", port: 465 }, passwordHint: "Gmail needs an app password: Google Account › Security › 2-Step Verification › App passwords." }],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, { name: "Outlook", host: "outlook.office365.com", smtp: { host: "smtp-mail.outlook.com", port: 587 }, passwordHint: "Outlook.com may need an app password: Microsoft account › Security › Advanced security options." }],
  [/^(icloud|me|mac)\.com$/, { name: "iCloud", host: "imap.mail.me.com", smtp: { host: "smtp.mail.me.com", port: 587 }, passwordHint: "iCloud needs an app-specific password: appleid.apple.com › Sign-In and Security." }],
  [/^(yahoo|ymail)\.[a-z.]+$/, { name: "Yahoo", host: "imap.mail.yahoo.com", smtp: { host: "smtp.mail.yahoo.com", port: 465 }, passwordHint: "Yahoo needs an app password: Account security › Generate app password." }],
  [/^aol\.com$/, { name: "AOL", host: "imap.aol.com", smtp: { host: "smtp.aol.com", port: 465 }, passwordHint: "AOL needs an app password: Account security › Generate app password." }],
  [/^(fastmail\.(com|fm)|messagingengine\.com)$/, { name: "Fastmail", host: "imap.fastmail.com", smtp: { host: "smtp.fastmail.com", port: 465 }, passwordHint: "Fastmail needs an app password: Settings › Privacy & Security › App passwords." }],
  [/^zoho(mail)?\.[a-z.]+$/, { name: "Zoho", host: "imap.zoho.com", smtp: { host: "smtp.zoho.com", port: 465 } }],
  [/^(proton\.me|protonmail\.com)$/, { name: "Proton", host: "127.0.0.1", smtp: { host: "127.0.0.1", port: 1025 }, passwordHint: "Proton Mail works through Proton Mail Bridge: use the host, port and password the Bridge shows." }],
];

export const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

export function providerFor(email: string): Provider | undefined {
  const domain = domainOf(email);
  return PROVIDERS.find(([re]) => re.test(domain))?.[1];
}

/** Settings to start from for an address. */
export function guessSettings(email: string): ImapSettings {
  const domain = domainOf(email);
  const p = providerFor(email);
  if (p?.name === "Proton") return { host: p.host, port: 1143, secure: false, user: email.trim() };
  return { host: p?.host ?? (domain ? `imap.${domain}` : ""), port: 993, secure: true, user: email.trim() };
}

/** SMTP settings to start from for an address. */
export function guessSmtp(email: string): SmtpSettings {
  const domain = domainOf(email);
  const p = providerFor(email);
  const host = p?.smtp.host ?? (domain ? `smtp.${domain}` : "");
  const port = p?.smtp.port ?? 465;
  return { host, port, secure: port === 465, user: email.trim() };
}

/** Whether the provider puts mail sent over SMTP in Sent by itself. */
export const savesSent = (smtpHost: string) => /(^|\.)(gmail\.com|googlemail\.com|outlook\.com|office365\.com)$/.test(smtpHost);

export const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "::1";
