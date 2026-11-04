// Attachments' bytes, on disk in the data folder by content hash: files
// attached to drafts (so a draft doesn't depend on where the file was), and
// attachments opened before (so they open offline the next time).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export class Blobs {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** Keeps the bytes; returns their id (SHA-256, hex). */
  async put(bytes: Uint8Array): Promise<string> {
    const id = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const file = Bun.file(this.path(id));
    if (!(await file.exists())) await Bun.write(file, bytes);
    return id;
  }

  path(id: string): string {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error(`not a blob id: ${id}`);
    return join(this.dir, id);
  }

  has(id: string): Promise<boolean> {
    return Bun.file(this.path(id)).exists();
  }

  async get(id: string): Promise<Uint8Array> {
    return new Uint8Array(await Bun.file(this.path(id)).arrayBuffer());
  }
}
