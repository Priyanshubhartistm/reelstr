import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { Agent, MockAdapter, registry, Verifier } from "@reelstr/agent";
import { ReelstrClient } from "@reelstr/app-core";
import { BlossomClient } from "@reelstr/blossom";
import { Indexer } from "@reelstr/indexer";
import { createApi } from "@reelstr/indexer/src/server";
import { createKeyServer } from "@reelstr/keys";
import { ingestScene, renderAndPublish } from "@reelstr/media-service";
import { createMediaServer } from "@reelstr/media-service/src/server";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import {
  FakeLightning,
  startBlossom,
  startCrewRelay,
  startFakeMint,
  startNutshell,
  startRelay,
} from "@reelstr/testkit";
import { CashuWallet, MemoryStore } from "@reelstr/wallet";

export const ROOT = join(import.meta.dir, "..", "..");
/** Fixed ports: the apps' built-in defaults already point here. */
export const PORTS = {
  relay: 3334,
  crew: 3335,
  blossom: 3100,
  mirror: 3101,
  media: 3200,
  indexer: 3300,
  keys: 3400,
  mint: 3338,
  web: 5173,
};

/** Keys that must be known before the apps are built (the verifier is trusted by pubkey). */
const KEYFILE = join(ROOT, "demo", ".demo-keys.json");
export function demoKeys() {
  try {
    return JSON.parse(readFileSync(KEYFILE, "utf8")) as Record<string, string>;
  } catch {
    const k = Object.fromEntries(
      ["verifier", "agent", "agentLock", "mara", "dev", "ila"].map((n) => [
        n,
        bytesToHex(randomBytes(32)),
      ]),
    );
    writeFileSync(KEYFILE, JSON.stringify(k));
    return k;
  }
}

function serveApp(app: "web", port: number, env: Record<string, string>) {
  const dir = join(ROOT, "apps", app);
  const b = Bun.spawnSync(["bunx", "vite", "build"], { cwd: dir, env: { ...process.env, ...env } });
  if (b.exitCode !== 0) throw new Error(`${app} build failed: ${b.stderr.toString()}`);
  const dist = join(dir, "dist");
  return Bun.serve({
    port,
    async fetch(req) {
      const p = new URL(req.url).pathname;
      const f = Bun.file(join(dist, p === "/" ? "index.html" : p));
      return (await f.exists())
        ? new Response(f)
        : new Response(Bun.file(join(dist, "index.html")));
    },
  });
}

export async function startStack(log: (s: string) => void) {
  const keys = demoKeys();
  const verifierSigner = new LocalSigner(hexToBytes(keys.verifier as string));
  const agentSigner = new LocalSigner(hexToBytes(keys.agent as string));
  const relayUrl = (await startRelay({ port: PORTS.relay })).url;
  const crewUrl = (await startCrewRelay({ port: PORTS.crew })).url;
  const A = await startBlossom({ port: PORTS.blossom });
  const B = await startBlossom({ port: PORTS.mirror });
  log("relay, crew relay, two Blossom servers up");
  const mint =
    (await startNutshell({ port: PORTS.mint })) ??
    (await startFakeMint({ lightning: new FakeLightning() }));
  log(`mint up (${mint.url})`);
  const svc = LocalSigner.generate();
  process.env.PORT = String(PORTS.media);
  const media = createMediaServer({
    hosts: { primary: new BlossomClient(A.url, svc), mirrors: [new BlossomClient(B.url, svc)] },
    run: { ingest: ingestScene, render: renderAndPublish },
  });
  const ix = await Indexer.open();
  await ix.follow([relayUrl]);
  const api = createApi(ix, PORTS.indexer);
  const ln = new FakeLightning();
  const keyServer = await createKeyServer({
    mints: [mint.url],
    port: PORTS.keys,
    ln: {
      createInvoice: async (o) => ln.createInvoice(o),
      isPaid: async (h) => ln.isPaid(h),
      payInvoice: async (i) => ({ preimage: ln.pay(i).preimage }),
    },
  });
  log("media service, indexer, key server up");

  const endpoints = {
    relays: [relayUrl],
    blossom: A.url,
    mirrors: [B.url],
    mediaUrl: `http://127.0.0.1:${PORTS.media}`,
    indexerUrl: `http://127.0.0.1:${PORTS.indexer}`,
    keysUrl: keyServer.url,
  };

  // an agent anyone can commission, and a verifier that labels what it can re-render
  const pool = new RelayPool();
  const adapters = registry(new MockAdapter("mock-open-1"));
  const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(keys.agentLock as string)));
  const agent = new Agent({
    signer: agentSigner,
    pool,
    relays: [relayUrl],
    adapters,
    priceSats: 21,
    client: new ReelstrClient({ signer: agentSigner, ...endpoints }),
    wallet: await CashuWallet.open(mint.url, new MemoryStore()),
    lockPrivkey: keys.agentLock as string,
    lockPubkey: lockPub,
    mints: [mint.url],
    name: "demo-bot",
    onLog: (l) => log(`agent: ${l}`),
  });
  await agent.start();
  const verifier = new Verifier({
    signer: verifierSigner,
    pool,
    relays: [relayUrl],
    adapters,
    onLog: (l) => log(`verifier: ${l}`),
  });
  verifier.start();

  const appEnv = {
    VITE_MINT: mint.url,
    VITE_FIAT_DEMO: "1",
    VITE_VERIFIERS: await verifierSigner.getPublicKey(),
  };
  mkdirSync(join(ROOT, "demo"), { recursive: true });
  const web = serveApp("web", PORTS.web, appEnv);
  log("Web app built and served");

  return {
    endpoints,
    mintUrl: mint.url,
    crewUrl,
    agentPubkey: await agentSigner.getPublicKey(),
    verifierPubkey: await verifierSigner.getPublicKey(),
    webUrl: `http://127.0.0.1:${web.port}`,
    stop: () => {
      agent.stop();
      verifier.stop();
      web.stop(true);
      media.stop(true);
      api.stop(true);
      keyServer.stop();
    },
  };
}
