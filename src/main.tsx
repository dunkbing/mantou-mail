// bun run dev  (mantou run src/main.tsx --width 1200 --height 760)
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
import { createMail } from "./state";

useRealTime();
const dir = dataDir();
const remote = new Remote(new Store(dir), osSecrets, { blobs: new Blobs(join(dir, "attachments")) });
const start = remote.initial();
const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
void remote.attach(mail);

run(() => <App mail={mail} remote={remote} />, { title: "Mantou Mail" });
