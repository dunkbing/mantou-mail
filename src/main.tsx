// bun run dev  (mantou run src/main.tsx --width 1200 --height 760)
import { run } from "mantou-ui";
import { App } from "./App";

run(() => <App />, { title: "Mantou Mail" });
