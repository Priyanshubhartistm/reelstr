import { hexToBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { demoKeys, PORTS, ROOT } from "./stack";

/** Rebuild both apps with the running demo's settings (for UI work: the demo serves dist/ from disk). */
const env = {
  ...process.env,
  VITE_MINT: `http://127.0.0.1:${PORTS.mint}`,
  VITE_FIAT_DEMO: "1",
  VITE_TESTNET: "1",
  VITE_VERIFIERS: await new LocalSigner(hexToBytes(demoKeys().verifier as string)).getPublicKey(),
};
for (const app of ["web"]) {
  const b = Bun.spawnSync(["bunx", "vite", "build"], { cwd: `${ROOT}/apps/${app}`, env });
  if (b.exitCode !== 0) throw new Error(`${app}: ${b.stderr.toString()}`);
  console.log("built", app);
}
