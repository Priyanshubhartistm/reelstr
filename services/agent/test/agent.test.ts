import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { ReelstrClient } from "@reelstr/app-core";
import { BlossomClient } from "@reelstr/blossom";
import { credits, Indexer } from "@reelstr/indexer";
import { ingestScene, renderAndPublish } from "@reelstr/media-service";
import { createMediaServer } from "@reelstr/media-service/src/server";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import {
  buildCut,
  buildStory,
  cutD,
  KIND,
  parseScene,
  parseVerification,
  validateEvent,
} from "@reelstr/protocol";
import { cleanup, FakeLightning, startBlossom, startFakeMint, startRelay } from "@reelstr/testkit";
import { acceptResult, awaitResult, CashuWallet, requestJob } from "@reelstr/wallet";
import {
  Agent,
  type GenAdapter,
  MockAdapter,
  registry,
  Verifier,
  verificationTemplate,
  verifyScene,
} from "../src";

let relay: Awaited<ReturnType<typeof startRelay>>;
let A: Awaited<ReturnType<typeof startBlossom>>;
let media: ReturnType<typeof createMediaServer>;
let mint: Awaited<ReturnType<typeof startFakeMint>>;
const ln = new FakeLightning();
const pool = new RelayPool();
const settle = async (i: string) => {
  try {
    ln.pay(i);
  } catch {}
};

beforeAll(async () => {
  relay = await startRelay();
  A = await startBlossom();
  mint = await startFakeMint({ lightning: ln });
  process.env.PORT = "0";
  const svc = LocalSigner.generate();
  media = createMediaServer({
    hosts: { primary: new BlossomClient(A.url, svc), mirrors: [] },
    run: { ingest: ingestScene, render: renderAndPublish },
  });
}, 120_000);
afterAll(() => {
  media.stop(true);
  mint.stop();
  pool.close([relay.url]);
  cleanup();
});

async function setup(opts: { price?: number } = {}) {
  const agentSigner = LocalSigner.generate();
  const lockPriv = bytesToHex(randomBytes(32));
  const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
  const client = new ReelstrClient({
    signer: agentSigner,
    relays: [relay.url],
    blossom: A.url,
    mediaUrl: `http://127.0.0.1:${media.port}`,
  });
  const adapters = registry(new MockAdapter("mock-open-1"));
  const closed: GenAdapter = {
    model: "kling-3",
    open: false,
    notes: "closed",
    generate: async () => new Uint8Array(),
  };
  adapters.set("kling-3", closed);
  const agent = new Agent({
    signer: agentSigner,
    pool,
    relays: [relay.url],
    adapters,
    priceSats: opts.price ?? 100,
    client,
    wallet: await CashuWallet.open(mint.url),
    lockPrivkey: lockPriv,
    lockPubkey: lockPub,
    mints: [mint.url],
    name: "mock-bot",
  });
  await agent.start(5);
  const human = LocalSigner.generate();
  const wallet = await CashuWallet.open(mint.url);
  await wallet.topUp(1000, settle);
  const story = { pubkey: await human.getPublicKey(), d: "agent-story" };
  await pool.publish(await human.signEvent(buildStory({ d: story.d, title: "S", logline: "l" })), [
    relay.url,
  ]);
  const r = { signer: human, pool, relays: [relay.url] };
  return {
    agent,
    agentSigner,
    human,
    wallet,
    story,
    r,
    adapters,
    pk: await agentSigner.getPublicKey(),
  };
}

describe("generation agent (NP-5, NP-6, PY-4)", () => {
  test("job -> signed scene draft -> accept -> nutzap paid within a minute; scene names agent and commissioner", async () => {
    const w = await setup();
    const me = await w.human.getPublicKey();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "a steel vault door, rain",
      story: w.story,
      model: "mock-open-1",
      seed: 828341,
      durationSec: 12,
      bidSats: 250,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    // the delivery is a draft: nothing public until accepted
    expect((await pool.query([relay.url], { kinds: [KIND.SCENE] })).length).toBe(0);
    const t0 = Date.now();
    const acc = await acceptResult(w.r, result, w.wallet, 250);
    const s = parseScene(acc.scene);
    expect(s).toMatchObject({ author: w.pk, commissioner: me, payee: me, license: "CC-BY-SA-4.0" });
    expect(s.gen).toMatchObject({ model: { name: "mock-open-1", open: true }, seed: "828341" });
    expect(validateEvent(acc.scene, { verifySig: true }).ok).toBe(true);
    expect((await pool.query([relay.url], { kinds: [KIND.SCENE] })).map((e) => e.id)).toEqual([
      acc.scene.id,
    ]);
    for (let i = 0; i < 80 && w.agent.paid.length === 0; i++)
      await new Promise((r) => setTimeout(r, 250));
    expect(w.agent.paid).toHaveLength(1);
    expect(w.agent.paid[0]).toMatchObject({ jobId: job.id, resultId: result.id, sats: 250 });
    expect((Date.now() - t0) / 1000).toBeLessThan(60);
    expect(w.wallet.balance()).toBe(750);
    w.agent.stop();
  }, 240_000);

  test("refuses: low bid, closed model, unknown model; nothing is generated and nothing is paid", async () => {
    const w = await setup({ price: 300 });
    const scenesBefore = (await pool.query([relay.url], { kinds: [KIND.SCENE] })).length;
    const base = { agent: w.pk, prompt: "p", story: w.story, durationSec: 8, bidSats: 500 };
    const low = await requestJob(w.r, { ...base, model: "mock-open-1", bidSats: 10 });
    const closed = await requestJob(w.r, { ...base, model: "kling-3" });
    const unknown = await requestJob(w.r, { ...base, model: "nope" });
    await expect(awaitResult(w.r, low.id, w.pk, 30_000)).rejects.toThrow(
      /below this agent's price/,
    );
    await expect(awaitResult(w.r, closed.id, w.pk, 30_000)).rejects.toThrow(/closed-weight/);
    await expect(awaitResult(w.r, unknown.id, w.pk, 30_000)).rejects.toThrow(/not offered/);
    expect((await pool.query([relay.url], { kinds: [KIND.SCENE] })).length).toBe(scenesBefore);
    w.agent.stop();
  }, 120_000);

  test("payment rules: wrong payer, underpay, replay, and a nutzap for a delivery it never made are not honoured", async () => {
    const w = await setup();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "door",
      story: w.story,
      model: "mock-open-1",
      durationSec: 6,
      bidSats: 200,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    const { buildNutzap, parseNutzapInfo } = await import("@reelstr/wallet");
    const [info] = await pool.query([relay.url], { kinds: [KIND.NUTZAP_INFO], authors: [w.pk] });
    const ni = parseNutzapInfo(info as never);
    const zap = async (who: LocalSigner, sats: number, resultId = result.id) => {
      const proofs = await w.wallet.lockedSend(sats, ni.p2pk);
      return who.signEvent(
        buildNutzap({ proofs, mintUrl: mint.url, recipient: w.pk, eventId: resultId }),
      );
    };
    // someone else pays for the requester's job: rejected
    expect(await w.agent.onNutzap((await zap(LocalSigner.generate(), 200)) as never)).toBe(
      "rejected",
    );
    // underpay: rejected
    expect(await w.agent.onNutzap((await zap(w.human, 50)) as never)).toBe("rejected");
    // a nutzap that names an event that is not one of the agent's results: ignored
    expect(await w.agent.onNutzap((await zap(w.human, 200, "9".repeat(64))) as never)).toBe(
      "ignored",
    );
    expect(w.agent.paid).toHaveLength(0);
    // the right payment works once; a second valid payment for the same delivery is ignored
    expect(await w.agent.onNutzap((await zap(w.human, 200)) as never)).toBe("paid");
    expect(await w.agent.onNutzap((await zap(w.human, 200)) as never)).toBe("ignored");
    expect(w.agent.paid).toHaveLength(1);
    w.agent.stop();
  }, 240_000);

  test("acceptResult refuses a forged delivery and does not pay for it", async () => {
    const w = await setup();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "door",
      story: w.story,
      model: "mock-open-1",
      durationSec: 6,
      bidSats: 100,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    const before = w.wallet.balance();
    const scenesBefore = (await pool.query([relay.url], { kinds: [KIND.SCENE] })).length;
    const imposter = LocalSigner.generate();
    const forged = await imposter.signEvent({
      kind: KIND.JOB_RESULT,
      created_at: Math.floor(Date.now() / 1000),
      tags: result.tags,
      content: result.content,
    });
    await expect(acceptResult(w.r, forged as never, w.wallet, 100)).rejects.toThrow(
      /not signed by the agent/,
    );
    const tampered = {
      ...result,
      content: result.content.replace('"mock-open-1"', '"mock-open-2"'),
    };
    await expect(acceptResult(w.r, tampered as never, w.wallet, 100)).rejects.toThrow(
      /invalid|different scene/,
    );
    expect(w.wallet.balance()).toBe(before);
    expect((await pool.query([relay.url], { kinds: [KIND.SCENE] })).length).toBe(scenesBefore);
    w.agent.stop();
  }, 240_000);
});

const labels = (sceneId: string) =>
  pool.query([relay.url], { kinds: [KIND.LABEL], "#e": [sceneId] });

describe("Source Verified", () => {
  test("a true manifest re-renders byte-identically; a doctored seed or prompt is a mismatch; closed models are ineligible", async () => {
    const w = await setup();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "neon alley, slow pan",
      story: w.story,
      model: "mock-open-1",
      seed: 42,
      durationSec: 6,
      bidSats: 100,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    const scene = JSON.parse(result.content);
    const ok = await verifyScene(scene, { adapters: w.adapters });
    expect(ok).toMatchObject({ verdict: "verified", exact: true, similarity: 1 });
    // the manifest claims a different seed than the clip was made with
    const lie = {
      ...scene,
      tags: scene.tags.map((t: string[]) =>
        t[0] === "gen" && t[1] === "seed" ? ["gen", "seed", "43"] : t,
      ),
    };
    const bad = await verifyScene(lie, { adapters: w.adapters });
    expect(bad.verdict).toBe("mismatch");
    expect(bad.exact).toBe(false);
    expect(bad.similarity).toBeLessThan(0.95);
    const closed = {
      ...scene,
      tags: scene.tags.map((t: string[]) =>
        t[0] === "gen" && t[1] === "model" ? ["gen", "model", "kling-3", "closed"] : t,
      ),
    };
    expect((await verifyScene(closed, { adapters: w.adapters })).verdict).toBe("ineligible");
    // a verifier's signed label lands in the index, where clients choose whom to trust
    const verifier = LocalSigner.generate();
    const label = await verifier.signEvent(
      verificationTemplate({ id: scene.id, videoSha: parseScene(scene).videoSha }, ok),
    );
    expect(parseVerification(label as never)).toMatchObject({ verdict: "verified", exact: true });
    expect(validateEvent(label as never).ok).toBe(true);
    w.agent.stop();
  }, 300_000);
});

describe("Verifier service", () => {
  test("follows the relay, publishes a signed verified label for a true scene, once", async () => {
    const w = await setup();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "rooftop rain",
      story: w.story,
      model: "mock-open-1",
      seed: 7,
      durationSec: 6,
      bidSats: 100,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    const scene = JSON.parse(result.content);
    await pool.publish(scene, [relay.url]); // the agent's draft is a signed scene; publishing it is the commissioner's call
    const verifierKey = LocalSigner.generate();
    const v = new Verifier({
      signer: verifierKey,
      pool,
      relays: [relay.url],
      adapters: w.adapters,
    });
    v.start(60);
    await v.idle();
    for (let i = 0; i < 100 && !(await labels(scene.id)).length; i++) await Bun.sleep(150);
    await v.idle();
    const got = (await labels(scene.id)).map((e) => parseVerification(e as never));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      verdict: "verified",
      exact: true,
      verifier: await verifierKey.getPublicKey(),
    });
    v.stop();
    w.agent.stop();
  }, 300_000);
});

describe("credits show agent and commissioner separately (NP-6)", () => {
  test("a Cut using an agent-made scene pays the commissioner and lists the agent", async () => {
    const w = await setup();
    const me = await w.human.getPublicKey();
    const job = await requestJob(w.r, {
      agent: w.pk,
      prompt: "door",
      story: w.story,
      model: "mock-open-1",
      durationSec: 8,
      bidSats: 100,
    });
    const result = await awaitResult(w.r, job.id, w.pk, 120_000);
    const acc = await acceptResult(w.r, result, w.wallet, 100);
    const s = parseScene(acc.scene);
    const cur = LocalSigner.generate();
    const curPk = await cur.getPublicKey();
    const cut = await cur.signEvent(
      buildCut({
        curator: curPk,
        seriesSlug: "ag",
        episode: 1,
        title: "t",
        synopsis: "s",
        scenes: [{ id: acc.scene.id, sha256: s.videoSha, inSec: 0, outSec: 8, payee: s.payee }],
        price: { amount: 10 },
        curatorBps: 2000,
        hostBps: 1000,
        host: curPk,
      }),
    );
    const ix = await Indexer.open();
    await ix.ingest(acc.scene as never);
    await ix.ingest(cut as never);
    const c = await credits(ix.db, cut.id);
    const creator = c.find((x) => x.role === "creator");
    expect(creator).toMatchObject({ pubkey: me, agents: [w.pk], weight: 7000 });
    await ix.close();
    w.agent.stop();
    expect(cutD("ag", 1)).toBe("ag:ep-001");
  }, 240_000);
});
