// bun run demo-server: an IMAP server on this machine with the sample mail, to
// try real accounts without one. In the app: Add your account, then
//   Email sam@northwind.dev · Password testpass · Server 127.0.0.1, port 1143 · Username testuser
// Nothing is saved: restarting the server starts over.
import hoodiecrow from "hoodiecrow-imap";
import { DEMO_PLUGINS, demoStorage } from "./demo-mailbox";

const port = Number(process.env.PORT ?? 1143);
const server = hoodiecrow({ plugins: DEMO_PLUGINS, storage: demoStorage() });
server.listen(port, "127.0.0.1", () => {
  console.log(`IMAP demo server on 127.0.0.1:${port} (user testuser, password testpass). Ctrl+C stops it.`);
});
