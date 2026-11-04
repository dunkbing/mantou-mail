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

/** How to get an app password: why it's needed, the steps, and the page where it's made. */
export interface PasswordGuide {
  why: string;
  steps: string[];
  /** The provider's page for it, and its name on the button. */
  url?: string;
  page?: string;
}

export interface Provider {
  name: string;
  host: string;
  smtp: { host: string; port: number };
  /** Several providers need an app password for IMAP: how to get one. */
  guide?: PasswordGuide;
}

const copy = "Copy the password it shows into Password here, and press Connect.";

const PROVIDERS: [RegExp, Provider][] = [
  [/^(gmail|googlemail)\.com$/, {
    name: "Gmail", host: "imap.gmail.com", smtp: { host: "smtp.gmail.com", port: 465 },
    guide: {
      why: "Gmail needs an app password for mail apps: your Google password won't work here.",
      steps: ["2-Step Verification has to be on in your Google Account (Security › 2-Step Verification).", "Open App passwords (below), sign in, and name the new one “Mantou Mail”.", copy],
      url: "https://myaccount.google.com/apppasswords", page: "Google's App passwords",
    },
  }],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, {
    name: "Outlook", host: "outlook.office365.com", smtp: { host: "smtp-mail.outlook.com", port: 587 },
    guide: { why: "Outlook.com and Microsoft 365 don't take passwords from mail apps any more: they need signing in with Microsoft, which this copy of Mantou Mail isn't set up for (docs/oauth.md).", steps: [] },
  }],
  [/^(icloud|me|mac)\.com$/, {
    name: "iCloud", host: "imap.mail.me.com", smtp: { host: "smtp.mail.me.com", port: 587 },
    guide: {
      why: "iCloud Mail needs an app-specific password for mail apps: your Apple Account password won't work here.",
      steps: ["Open your Apple Account (below) and sign in. Two-factor authentication has to be on.", "Go to Sign-In and Security › App-Specific Passwords, and press +.", "Name it “Mantou Mail”. " + copy],
      url: "https://account.apple.com/account/manage", page: "Apple Account",
    },
  }],
  [/^(yahoo|ymail)\.[a-z.]+$/, {
    name: "Yahoo", host: "imap.mail.yahoo.com", smtp: { host: "smtp.mail.yahoo.com", port: 465 },
    guide: {
      why: "Yahoo Mail needs an app password for mail apps: your Yahoo password won't work here.",
      steps: ["Open Yahoo's Account security (below) and sign in.", "Choose Generate app password (or Manage app passwords), and name it “Mantou Mail”.", copy],
      url: "https://login.yahoo.com/account/security", page: "Yahoo Account security",
    },
  }],
  [/^aol\.com$/, {
    name: "AOL", host: "imap.aol.com", smtp: { host: "smtp.aol.com", port: 465 },
    guide: {
      why: "AOL Mail needs an app password for mail apps: your AOL password won't work here.",
      steps: ["Open AOL's Account security (below) and sign in.", "Choose Generate app password, and name it “Mantou Mail”.", copy],
      url: "https://login.aol.com/account/security", page: "AOL Account security",
    },
  }],
  [/^(fastmail\.(com|fm)|messagingengine\.com)$/, {
    name: "Fastmail", host: "imap.fastmail.com", smtp: { host: "smtp.fastmail.com", port: 465 },
    guide: {
      why: "Fastmail needs an app password for mail apps: your Fastmail password won't work here.",
      steps: ["Open Fastmail (below) and sign in.", "Go to Settings › Privacy & Security › App passwords (Manage app passwords and access), and make a new one with access to Mail (IMAP, POP and SMTP).", copy],
      url: "https://app.fastmail.com/settings/security", page: "Fastmail settings",
    },
  }],
  [/^zoho(mail)?\.[a-z.]+$/, {
    name: "Zoho", host: "imap.zoho.com", smtp: { host: "smtp.zoho.com", port: 465 },
    guide: {
      why: "Zoho Mail needs IMAP access turned on, and an app password if two-factor authentication is on.",
      steps: ["In Zoho Mail, turn on IMAP access: Settings › Mail Accounts › IMAP.", "Open Zoho Accounts (below) › Security › App Passwords, and generate one named “Mantou Mail”.", copy],
      url: "https://accounts.zoho.com/home#security/app_password", page: "Zoho Accounts",
    },
  }],
  [/^(proton\.me|protonmail\.com)$/, {
    name: "Proton", host: "127.0.0.1", smtp: { host: "127.0.0.1", port: 1025 },
    guide: {
      why: "Proton Mail works with mail apps through Proton Mail Bridge, which runs on this computer.",
      steps: ["Install and open Proton Mail Bridge (below), and add your account to it.", "Bridge shows a password and the IMAP and SMTP ports for mail apps.", "Use that password, and those ports, here."],
      url: "https://proton.me/mail/bridge", page: "Proton Mail Bridge",
    },
  }],
];

/** For a provider the app doesn't know, or after a password was refused. */
export const GENERIC_GUIDE: PasswordGuide = {
  why: "If your account has 2-step verification, it most likely needs an app password for mail apps, not your usual one.",
  steps: ["In your mail provider's account settings, look under Security for “App passwords” and make one named “Mantou Mail”.", "Your provider's help pages list its IMAP and SMTP servers: search for “<provider> IMAP settings”.", copy],
};

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
