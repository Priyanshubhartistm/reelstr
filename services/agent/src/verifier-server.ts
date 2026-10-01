import { installUrlRewrite } from "@reelstr/blossom";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { FalWanAdapter, MockAdapter, registry, Verifier } from "./index";

/**
 * Runs a verifier: re-renders eligible scenes from their manifests and publishes signed verdicts.
 *   RELAYS, VERIFIER_NSEC (a stable key: viewers trust you by it), FAL_KEY and/or MOCK=1
 */
installUrlRewrite();
const nsec = process.env.VERIFIER_NSEC;
if (!nsec) {
  console.error("VERIFIER_NSEC is required: viewers trust a verifier by its public key");
  process.exit(1);
}
const signer = LocalSigner.fromNsec(nsec);
const adapters = registry(
  ...(process.env.FAL_KEY ? [new FalWanAdapter(process.env.FAL_KEY)] : []),
  ...(process.env.MOCK ? [new MockAdapter()] : []),
);
if (adapters.size === 0) {
  console.error("no engines: set FAL_KEY and/or MOCK=1");
  process.exit(1);
}
const relays = (process.env.RELAYS ?? "ws://127.0.0.1:3334").split(",");
const v = new Verifier({
  signer,
  pool: new RelayPool(),
  relays,
  adapters,
  onLog: (l) => console.log(new Date().toISOString(), l),
});
v.start(Number(process.env.VERIFY_SINCE_SEC ?? 86400));
console.log(
  `verifier ${await signer.getPublicKey()} on ${relays.join(", ")}, engines: ${[...adapters.keys()].join(", ")}`,
);
