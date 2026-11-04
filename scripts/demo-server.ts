// bun run demo-server: an IMAP and SMTP server on this machine with the sample
// mail, to try real accounts without one. In the app: Add your account, then
//   Email sam@northwind.dev · Password testpass · IMAP 127.0.0.1, port 1143 ·
//   SMTP 127.0.0.1, port 1025 · Username testuser
// Mail sent to sam@northwind.dev arrives in its Inbox; mail to anyone else is
// accepted and dropped. Nothing is saved: restarting the server starts over.
import hoodiecrow from "hoodiecrow-imap";
import { SMTPServer } from "smtp-server";
import { DEMO_PLUGINS, demoStorage } from "./demo-mailbox";

const port = Number(process.env.PORT ?? 1143);
const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
const imap = hoodiecrow({ plugins: DEMO_PLUGINS, storage: demoStorage() });
imap.listen(port, "127.0.0.1", () => console.log(`IMAP on 127.0.0.1:${port} (user testuser, password testpass)`));

const smtp = new SMTPServer({
  logger: false,
  disabledCommands: ["STARTTLS"], // this machine only
  onAuth: (auth, _session, done) => done(auth.password === "testpass" ? null : new Error("Invalid credentials"), { user: auth.username }),
  onData(stream, session, done) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      const to = session.envelope.rcptTo.map((r) => r.address);
      if (to.includes("sam@northwind.dev")) (imap as unknown as { appendMessage(path: string, flags: string[], date: boolean, raw: string): void }).appendMessage("INBOX", [], false, Buffer.concat(chunks).toString("binary"));
      console.log(`SMTP: a message to ${to.join(", ")}`);
      done();
    });
  },
});
smtp.listen(smtpPort, "127.0.0.1", () => console.log(`SMTP on 127.0.0.1:${smtpPort}. Ctrl+C stops both.`));
