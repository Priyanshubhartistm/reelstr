import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { demoKeys, ROOT } from "./stack";

/**
 * Write infra/.env from .env.example with the secrets and the demo identities filled in, so the
 * compose stack, the seed script and the smoke scripts all agree on who the agent and verifier are.
 *   bun demo/src/envgen.ts [--host <PUBLIC_HOST>]      (an existing .env is never overwritten)
 */
const out = join(ROOT, "infra", ".env");
if (existsSync(out)) {
  console.log(`${out} exists, leaving it alone`);
  process.exit(0);
}
const host = process.argv.includes("--host")
  ? (process.argv[process.argv.indexOf("--host") + 1] as string)
  : "localhost";
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
};
const lines = readFileSync(join(ROOT, "infra", ".env.example"), "utf8")
  .split("\n")
  .map((l) => {
    const m = l.match(/^([A-Z_]+)=/);
    return m && set[m[1] as string] !== undefined ? `${m[1]}=${set[m[1] as string]}` : l;
  });
writeFileSync(out, lines.join("\n"), { mode: 0o600 });
console.log(`wrote ${out} (PUBLIC_HOST=${host})`);
