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
import { createAsk } from "./agent/ask";
import { createReplies } from "./agent/replies";
import { createSummaries } from "./agent/summary";
import { createTriage } from "./agent/triage";
import { confirm } from "./mail/files";
import { createMail } from "./state";

useRealTime();
const dir = dataDir();
const remote = new Remote(new Store(dir), osSecrets, { blobs: new Blobs(join(dir, "attachments")) });
const start = remote.initial();
const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange, proposals: remote.pendingProposals(), onDecide: remote.decide });
void remote.attach(mail);
// The agent (Claude through ACP, with the person's own login) reads mail only after they've agreed once.
let agreed = false;
const consent = async () =>
  agreed ||
  (agreed = await confirm({ title: "Let the agent read this mail?", message: "The agent reads the mail it looks at and sends its text to Claude, through your own Claude login. It can only suggest: nothing changes until you approve it. Go on?", buttons: ["Go on", "Cancel"] }));
// "Review my inbox" proposes tidying for the Queue; long conversations can be summarised.
const triage = createTriage(mail, remote.store, { confirm: consent });
const summaries = createSummaries(remote.store, { confirm: consent });
const replies = createReplies({ confirm: consent });
const ask = createAsk(mail, { confirm: consent });

run(() => <App mail={mail} remote={remote} triage={triage} summaries={summaries} replies={replies} ask={ask} />, { title: "Mantou Mail", width: 1200, height: 760, minWidth: 980, minHeight: 600, titleBar: "overlay" });
