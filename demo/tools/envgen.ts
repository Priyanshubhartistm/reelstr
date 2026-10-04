import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { demoKeys, ROOT } from "../src/stack";

/**
 * Write infra/.env from .env.example with the secrets and the demo identities filled in, so the
 * compose stack, the seed script and the smoke scripts all agree on who the agent and verifier are.
 *   bun demo/tools/envgen.ts [--host <PUBLIC_HOST>]      (an existing .env is never overwritten)
 */
const out = join(ROOT, "infra", ".env");
if (existsSync(out)) {
  console.log(`${out} exists, leaving it alone`);
  process.exit(0);
}
const host = process.argv.includes("--host")
  ? (process.argv[process.argv.indexOf("--host") + 1] as string)
  : "localhost";
// --public-base https://host/reelstr : everything is served by a reverse proxy under one hostname
const base = process.argv.includes("--public-base")
  ? (process.argv[process.argv.indexOf("--public-base") + 1] as string).replace(/\/+$/, "")
  : "";
const k = demoKeys();
const sk = (hex: string) => new LocalSigner(hexToBytes(hex));
const set: Record<string, string> = {
  PUBLIC_HOST: host,
  MINT_URL: `http://${host}:3338`,
  POSTGRES_PASSWORD: bytesToHex(randomBytes(12)),
  CREW_RELAY_SECRET: bytesToHex(randomBytes(32)),
  AGENT_NSEC: sk(k.agent as string).backup(),
  AGENT_LOCK_PRIVKEY: k.agentLock as string,
  VERIFIER_NSEC: sk(k.verifier as string).backup(),
  VERIFIERS: await sk(k.verifier as string).getPublicKey(),
  MOCK: "1",
  FIAT_DEMO: "1",
  ...(base
    ? {
        BLOSSOM_PUBLIC_URL: `${base}/blossom`,
        MINT_URL: `${base}/mint`,
        MEDIA_PATH_PREFIX: `${new URL(base).pathname.replace(/\/+$/, "")}/media`,
        KEYS_PATH_PREFIX: `${new URL(base).pathname.replace(/\/+$/, "")}/keys`,
      }
    : { BLOSSOM_PUBLIC_URL: `http://${host}:3100` }),
};
const lines = readFileSync(join(ROOT, "infra", ".env.example"), "utf8")
  .split("\n")
  .map((l) => {
    const m = l.match(/^([A-Z_]+)=/);
    return m && set[m[1] as string] !== undefined ? `${m[1]}=${set[m[1] as string]}` : l;
  });
writeFileSync(out, lines.join("\n"), { mode: 0o600 });
console.log(`wrote ${out} (PUBLIC_HOST=${host})`);
if (base) {
  const ws = base.replace(/^http/, "ws");
  console.log(
    `\nBuild the frontend against it with:\n  VITE_RELAYS=${ws}/relay VITE_BLOSSOM=${base}/blossom VITE_MEDIA_URL=${base}/media \\\n  VITE_INDEXER_URL=${base}/api VITE_KEYS_URL=${base}/keys VITE_MINT=${base}/mint VITE_CREW_RELAY=${ws}/crew \\\n  VITE_VERIFIERS=${set.VERIFIERS}`,
  );
}
