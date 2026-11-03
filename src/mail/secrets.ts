// Passwords live in the OS keychain (Bun.secrets: Keychain on macOS, the
// Secret Service on Linux, Credential Manager on Windows). Where there is no
// keychain, a password is kept in memory for this run only and asked for again
// next time: never written to disk.

const SERVICE = "Mantou Mail";
const memory = new Map<string, string>();
let keychain: boolean | undefined;

export interface Secrets {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** Whether passwords outlive this run. */
  persistent(): Promise<boolean>;
}

async function hasKeychain(): Promise<boolean> {
  if (keychain !== undefined) return keychain;
  try {
    await Bun.secrets.get({ service: SERVICE, name: "__probe__" });
    keychain = true;
  } catch {
    keychain = false;
  }
  return keychain;
}

export const osSecrets: Secrets = {
  async get(name) {
    if (memory.has(name)) return memory.get(name)!;
    return (await hasKeychain()) ? Bun.secrets.get({ service: SERVICE, name }) : null;
  },
  async set(name, value) {
    memory.set(name, value);
    if (await hasKeychain()) await Bun.secrets.set({ service: SERVICE, name, value });
  },
  async delete(name) {
    memory.delete(name);
    if (await hasKeychain()) await Bun.secrets.delete({ service: SERVICE, name });
  },
  persistent: hasKeychain,
};

/** Secrets in memory only, for tests. */
export function memorySecrets(): Secrets {
  const m = new Map<string, string>();
  return {
    get: async (n) => m.get(n) ?? null,
    set: async (n, v) => void m.set(n, v),
    delete: async (n) => void m.delete(n),
    persistent: async () => false,
  };
}
