declare module "hoodiecrow-imap" {
  import type { Server } from "node:net";
  export default function hoodiecrow(options?: Record<string, unknown>): Server;
}
