// IMAP settings for well-known providers, guessed from the address's domain.
// Anything else gets imap.<domain> on 993, which the user can change.

export interface ImapSettings {
  host: string;
  port: number;
  /** TLS from the start (993); otherwise STARTTLS is required, except on this machine. */
  secure: boolean;
  user: string;
}

export interface Provider {
  name: string;
  host: string;
  /** What to tell people about passwords (several providers need an app password for IMAP). */
  passwordHint?: string;
}

const PROVIDERS: [RegExp, Provider][] = [
  [/^(gmail|googlemail)\.com$/, { name: "Gmail", host: "imap.gmail.com", passwordHint: "Gmail needs an app password: Google Account › Security › 2-Step Verification › App passwords." }],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, { name: "Outlook", host: "outlook.office365.com", passwordHint: "Outlook.com may need an app password: Microsoft account › Security › Advanced security options." }],
  [/^(icloud|me|mac)\.com$/, { name: "iCloud", host: "imap.mail.me.com", passwordHint: "iCloud needs an app-specific password: appleid.apple.com › Sign-In and Security." }],
  [/^(yahoo|ymail)\.[a-z.]+$/, { name: "Yahoo", host: "imap.mail.yahoo.com", passwordHint: "Yahoo needs an app password: Account security › Generate app password." }],
  [/^aol\.com$/, { name: "AOL", host: "imap.aol.com", passwordHint: "AOL needs an app password: Account security › Generate app password." }],
  [/^(fastmail\.(com|fm)|messagingengine\.com)$/, { name: "Fastmail", host: "imap.fastmail.com", passwordHint: "Fastmail needs an app password: Settings › Privacy & Security › App passwords." }],
  [/^zoho(mail)?\.[a-z.]+$/, { name: "Zoho", host: "imap.zoho.com" }],
  [/^(proton\.me|protonmail\.com)$/, { name: "Proton", host: "127.0.0.1", passwordHint: "Proton Mail works through Proton Mail Bridge: use the host, port and password the Bridge shows." }],
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

export const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "::1";
