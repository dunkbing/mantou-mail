// bun run dev  (mantou run src/main.tsx)
// Real accounts are kept in the app's data folder (MANTOU_MAIL_HOME to use another).
import { run } from "mantou-ui";
import { App } from "./App";
import { useRealTime } from "./data";
import { dataDir } from "./mail/paths";
import { Remote } from "./mail/remote";
import { osSecrets } from "./mail/secrets";
import { Store } from "./mail/store";
import { Blobs } from "./mail/blobs";
import { join } from "node:path";
import { createTriage } from "./agent/triage";
import { confirm } from "./mail/files";
import { createMail } from "./state";

useRealTime();
const dir = dataDir();
const remote = new Remote(new Store(dir), osSecrets, { blobs: new Blobs(join(dir, "attachments")) });
const start = remote.initial();
const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange, proposals: remote.pendingProposals(), onDecide: remote.decide });
void remote.attach(mail);
// "Review my inbox": an agent (Claude through ACP, with the person's own login) proposes tidying for the Queue.
const triage = createTriage(mail, remote.store, {
  confirm: () => confirm({ title: "Review my inbox", message: "The agent reads the mail it looks at and sends its text to Claude, through your own Claude login. It can only suggest: nothing changes until you approve it. Go on?", buttons: ["Review", "Cancel"] }),
});

run(() => <App mail={mail} remote={remote} triage={triage} />, { title: "Mantou Mail", width: 1200, height: 760, minWidth: 980, minHeight: 600, titleBar: "overlay" });
