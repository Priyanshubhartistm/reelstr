import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { hexToBytes } from "@noble/hashes/utils.js";
import { ReelstrClient } from "@reelstr/app-core";
import { installUrlRewrite } from "@reelstr/blossom";
import { openLedger } from "@reelstr/keys";
import { LocalSigner, RelayPool, retry } from "@reelstr/nostr";
import { CashuWallet } from "@reelstr/wallet";
import { Agent, FalWanAdapter, MockAdapter, registry } from "./index";

/**
 * Run an agent. Environment:
 *   AGENT_NAME (profile name, default reelstr-agent), AGENT_NSEC, AGENT_LOCK_PRIVKEY (hex), RELAYS, BLOSSOM_URL, MEDIA_URL, MINT_URL,
 *   PRICE_SATS (default 100), FAL_KEY (optional: enables wan-2.2-t2v), MOCK=1 (enables mock-open-1)
 * Earnings are kept in AGENT_LEDGER_DB (sqlite, default ./agent.db).
 */
installUrlRewrite();
const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`${k} is required`);
  return v;
};
const relays = env("RELAYS", "ws://127.0.0.1:3334").split(",");
const signer = process.env.AGENT_NSEC
  ? LocalSigner.fromNsec(process.env.AGENT_NSEC)
  : LocalSigner.generate();
const lockPriv = env("AGENT_LOCK_PRIVKEY");
const mint = env("MINT_URL");
const adapters = registry(
  ...(process.env.FAL_KEY ? [new FalWanAdapter(process.env.FAL_KEY)] : []),
  ...(process.env.MOCK ? [new MockAdapter()] : []),
);
if (adapters.size === 0) throw new Error("no models enabled: set FAL_KEY and/or MOCK=1");

const agent = new Agent({
  signer,
  pool: new RelayPool(),
  relays,
  adapters,
  priceSats: Number(env("PRICE_SATS", "100")),
  client: new ReelstrClient({
    signer,
    relays,
    blossom: env("BLOSSOM_URL", "http://127.0.0.1:3100"),
    mediaUrl: env("MEDIA_URL", "http://127.0.0.1:3200"),
  }),
  // earnings persist: a restart must not lose what the agent has been paid
  wallet: await retry("mint", () =>
    CashuWallet.open(mint, openLedger(process.env.AGENT_LEDGER_DB ?? "agent.db").proofStore(mint)),
  ),
  lockPrivkey: lockPriv,
  lockPubkey: Buffer.from(getPubKeyFromPrivKey(hexToBytes(lockPriv))).toString("hex"),
  mints: [mint],
  name: process.env.AGENT_NAME,
  onLog: (l) => console.log(new Date().toISOString(), l),
});
await agent.start();
console.log(`agent ${agent.pubkey} serving ${[...adapters.keys()].join(", ")}`);
