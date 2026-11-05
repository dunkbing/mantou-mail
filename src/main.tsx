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
import { createMail } from "./state";
import { followDesktopScheme } from "./ui/desktopScheme";

useRealTime();
const dir = dataDir();
const remote = new Remote(new Store(dir), osSecrets, { blobs: new Blobs(join(dir, "attachments")) });
const start = remote.initial();
const mail = createMail(start.messages, { accounts: start.accounts, onChange: remote.onChange });
void remote.attach(mail);

run(() => <App mail={mail} remote={remote} />, { title: "Mantou Mail", width: 1200, height: 760, minWidth: 980, minHeight: 600, titleBar: "overlay" });
// Linux: the light or dark appearance from the desktop (Mantou doesn't see it there yet, dunkbing/mantou#79).
void followDesktopScheme();
