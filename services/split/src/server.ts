import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { installUrlRewrite } from "@reelstr/blossom";
import { type LnBackend, LndBackend, openLedger, PhoenixdBackend } from "@reelstr/keys";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { CashuWallet } from "@reelstr/wallet";
import { runPayouts } from "./index";

/**
 * Runs payouts on a timer against the key server's ledger (same file: LEDGER_DB).
 *   SPLIT_ACKNOWLEDGE_CUSTODY=1   required: this service holds money between unlock and payout
 *   LEDGER_DB, MINTS, RELAYS      as for the key server
 *   SPLIT_INTERVAL_SEC            default 3600; `--once` runs one pass and exits
 *   PHOENIXD_URL/PHOENIXD_PASSWORD or LND_URL/LND_MACAROON[/LND_CA]   Lightning-address payouts
 * The payout identity is generated once and kept in the ledger.
 */
installUrlRewrite();
const ack = process.env.SPLIT_ACKNOWLEDGE_CUSTODY === "1";
if (!ack) {
  console.error(
    "split service is custodial: set SPLIT_ACKNOWLEDGE_CUSTODY=1 to confirm you accept that responsibility",
  );
  process.exit(1);
}
const ledger = openLedger(process.env.LEDGER_DB ?? "keys.db");
const mints = (process.env.MINTS ?? "").split(",").filter(Boolean);
const relays = (process.env.RELAYS ?? "ws://127.0.0.1:3334").split(",");
const identity = new LocalSigner(
  hexToBytes(ledger.meta("split_nsec", () => bytesToHex(randomBytes(32)))),
);
const ln: LnBackend | undefined = process.env.PHOENIXD_URL
  ? new PhoenixdBackend(process.env.PHOENIXD_URL, process.env.PHOENIXD_PASSWORD ?? "")
  : process.env.LND_URL
    ? new LndBackend(process.env.LND_URL, process.env.LND_MACAROON ?? "", process.env.LND_CA)
    : undefined;
const wallets = new Map<string, CashuWallet>();
const walletFor = async (m: string) => {
  let w = wallets.get(m);
  if (!w) {
    w = await CashuWallet.open(m, ledger.proofStore(m));
    wallets.set(m, w);
  }
  return w;
};
const pool = new RelayPool();

async function pass() {
  try {
    const r = await runPayouts({
      acknowledgeCustody: true,
      ledger,
      pool,
      relays,
      identity,
      mints,
      walletFor,
      ln,
    });
    const paid = r.batches.reduce((n, b) => n + b.paid.length, 0);
    console.log(
      `${new Date().toISOString()} payouts: ${r.batches.length} batches, ${paid} payments, ${r.skipped.length} skipped, ${r.stuck} stuck`,
    );
    if (r.stuck > 0) console.error("STUCK payouts need a human: money may have moved");
  } catch (e) {
    console.error(`${new Date().toISOString()} payout pass failed: ${(e as Error).message}`);
  }
}

console.log(
  `split service as ${await identity.getPublicKey()}, mints: ${mints.join(", ") || "(none)"}`,
);
await pass();
if (process.argv.includes("--once")) process.exit(0);
setInterval(pass, Number(process.env.SPLIT_INTERVAL_SEC ?? 3600) * 1000);
