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

/** Start the NIP-29 crew relay (builds it first). Returns its ws:// URL. */
export async function startCrewRelay(opts: { port?: number } = {}) {
  const dir = join(ROOT, "services/crew");
  const b = Bun.spawnSync(["go", "build", "-o", "bin/crew", "."], { cwd: dir });
  if (b.exitCode !== 0) throw new Error(`crew relay build failed: ${b.stderr.toString()}`);
  const port = opts.port ?? freePort();
  procs.push(
    Bun.spawn([join(dir, "bin/crew")], {
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: tempDir("reelstr-crew-"),
        DOMAIN: "localhost",
      },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  await waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${port}`, { headers: { Accept: "application/nostr+json" } }))
        .ok,
    "crew relay",
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

export { startBunker } from "./fake-bunker";
export { FakeLightning } from "./fake-ln";
export { startFakeMint } from "./fake-mint";
export { startFakeNwc } from "./fake-nwc";

/**
 * Start the real Nutshell mint (Python, installed in .venv-mint) with its FakeWallet Lightning
 * backend. This is the reference Cashu mint implementation, not our own test double, so wallets
 * tested against it are tested against real NUT behaviour. Returns null if it is not installed.
 */
export async function startNutshell(opts: { port?: number } = {}) {
  const bin = join(ROOT, ".venv-mint/bin/mint");
  if (!(await Bun.file(bin).exists())) return null;
  const port = opts.port ?? freePort();
  const dir = tempDir("reelstr-nutshell-");
  const proc = Bun.spawn([bin], {
    env: {
      ...process.env,
      MINT_BACKEND_BOLT11_SAT: "FakeWallet",
      MINT_LISTEN_HOST: "127.0.0.1",
      MINT_LISTEN_PORT: String(port),
      MINT_PRIVATE_KEY: "reelstr-test-only-key",
      MINT_DATABASE: dir,
      CASHU_DIR: dir,
      FAKEWALLET_BRR: "TRUE",
      FAKEWALLET_DELAY_PAYMENT: "FALSE",
      FAKEWALLET_STOCHASTIC_INVOICE: "FALSE",
      MINT_INPUT_FEE_PPK: "0",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  procs.push(proc);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/v1/info`)).ok, "nutshell", 200);
  return { url: `http://127.0.0.1:${port}`, port, stop: () => proc.kill() };
}

/** POST JSON to a NIP-98 protected endpoint, signing URL, method and body as the given signer. */
export async function signedPost(
  signer: { signEvent: (t: never) => Promise<unknown> },
  url: string,
  body: unknown,
): Promise<Response> {
  const { httpAuthHeader, httpAuthTemplate } = await import("@reelstr/protocol");
  const text = JSON.stringify(body);
  const ev = await signer.signEvent(httpAuthTemplate({ url, method: "POST", body: text }) as never);
  return fetch(url, {
    method: "POST",
    headers: { Authorization: httpAuthHeader(ev), "Content-Type": "application/json" },
    body: text,
  });
}
