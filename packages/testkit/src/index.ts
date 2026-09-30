import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const procs: Bun.Subprocess[] = [];
const dirs: string[] = [];

export const tempDir = (prefix = "reelstr-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

async function waitFor(ready: () => Promise<boolean>, what: string, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await ready()) return;
    } catch {}
    await Bun.sleep(150);
  }
  throw new Error(`${what} did not start`);
}

/** Ask the OS for a free port (bind to 0, read it, release it) instead of guessing a range. */
export const freePort = (): number => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port as number;
  s.stop(true);
  return port;
};

/** Start the Go reference relay (builds it first). Returns its ws:// URL. */
export async function startRelay(opts: { powBits?: number; port?: number } = {}) {
  const dir = join(ROOT, "services/relay");
  const b = Bun.spawnSync(["go", "build", "-o", "bin/relay", "."], { cwd: dir });
  if (b.exitCode !== 0) throw new Error(`relay build failed: ${b.stderr.toString()}`);
  const port = opts.port ?? freePort();
  procs.push(
    Bun.spawn([join(dir, "bin/relay")], {
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: tempDir("reelstr-relay-"),
        POW_BITS: String(opts.powBits ?? 0),
      },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  await waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${port}`, { headers: { Accept: "application/nostr+json" } }))
        .ok,
    "relay",
  );
  return { url: `ws://127.0.0.1:${port}`, port };
}

/** Start a native blossom-server-ts. Returns { url, stop }. */
export async function startBlossom(opts: { port?: number } = {}) {
  const port = opts.port ?? freePort();
  const proc = Bun.spawn(["sh", join(ROOT, "infra/blossom/run.sh")], {
    env: { ...process.env, PORT: String(port), BLOSSOM_DATA: tempDir("reelstr-blossom-") },
    stdout: "ignore",
    stderr: "ignore",
  });
  procs.push(proc);
  const url = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(url)).status < 500, "blossom");
  return { url, port, stop: () => proc.kill() };
}

export function cleanup() {
  for (const p of procs.splice(0)) p.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export { FakeLightning } from "./fake-ln";
export { startFakeMint } from "./fake-mint";
export { startFakeNwc } from "./fake-nwc";
