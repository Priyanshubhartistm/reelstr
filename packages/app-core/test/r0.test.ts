import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BlossomClient } from "@reelstr/blossom";
import { Indexer } from "@reelstr/indexer";
import { createApi } from "@reelstr/indexer/src/server";
import { probe } from "@reelstr/media";
import { ingestScene, renderAndPublish } from "@reelstr/media-service";
import { createMediaServer } from "@reelstr/media-service/src/server";
import { LocalSigner } from "@reelstr/nostr";
import { KIND, parseCut, parseScene, validateEvent } from "@reelstr/protocol";
import { cleanup, startBlossom, startRelay, tempDir } from "@reelstr/testkit";
import { makeClip } from "../../media/test/helpers";
import { ReelstrClient } from "../src";

// The whole R0 loop against real services: relay, two Blossom servers, media service, indexer.
let relay: Awaited<ReturnType<typeof startRelay>>;
let A: Awaited<ReturnType<typeof startBlossom>>;
let B: Awaited<ReturnType<typeof startBlossom>>;
let media: ReturnType<typeof createMediaServer>;
let ix: Indexer;
let api: ReturnType<typeof createApi>;
const dir = tempDir();

const mk = (who: LocalSigner) =>
  new ReelstrClient({
    signer: who,
    relays: [relay.url],
    blossom: A.url,
    mirrors: [B.url],
    mediaUrl: `http://127.0.0.1:${media.port}`,
    mediaToken: "tok",
    indexerUrl: `http://127.0.0.1:${api.port}`,
  });

beforeAll(async () => {
  relay = await startRelay();
  A = await startBlossom();
  B = await startBlossom();
  const svc = LocalSigner.generate();
  process.env.PORT = "0";
  media = createMediaServer({
    token: "tok",
    hosts: { primary: new BlossomClient(A.url, svc), mirrors: [new BlossomClient(B.url, svc)] },
    run: { ingest: ingestScene, render: renderAndPublish },
  });
  ix = await Indexer.open();
  await ix.follow([relay.url]);
  api = createApi(ix, 0);
}, 120_000);
afterAll(async () => {
  media?.stop(true);
  api?.stop(true);
  await ix?.close();
  cleanup();
});

const until = async <T>(f: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(150);
  }
};

describe("R0 end to end", () => {
  test("create story, publish scenes, fork, curate an episode, index it all", async () => {
    const alice = mk(LocalSigner.generate());
    const bob = mk(LocalSigner.generate());
    const cara = mk(LocalSigner.generate());
    const [pa, pb, pc] = [await alice.me(), await bob.me(), await cara.me()];

    const story = await alice.createStory({
      d: "vault",
      title: "The Vault",
      logline: "A crew, a door, a clock.",
      cast: [{ name: "Mara" }],
    });
    const sref = { pubkey: pa, d: "vault" };

    const clip = async (n: string, freq: number) =>
      new Uint8Array(
        await Bun.file(
          await makeClip(join(dir, `${n}.mp4`), {
            size: "640x360",
            fps: 24,
            sec: 12,
            freq,
            gainDb: -22,
          }),
        ).arrayBuffer(),
      );

    const s1 = await alice.publishScene({
      bytes: await clip("s1", 300),
      title: "The door",
      prompt: "a steel vault door",
      story: sref,
    });
    expect(validateEvent(s1.event).ok).toBe(true);
    expect(parseScene(s1.event).duration).toBeCloseTo(12, 0);
    // fork by bob: carries parent, story, license
    const s2 = await bob.forkScene(s1.event, {
      bytes: await clip("s2", 500),
      title: "Door, take two",
      prompt: "same door, rain",
    });
    const f = parseScene(s2.event);
    expect(f.parentId).toBe(s1.event.id);
    expect(f.storyCoord).toBe(`${KIND.STORY}:${pa}:vault`);
    expect(f.payee).toBe(pb);

    // the indexer sees the tree and the fork
    const coord = `${KIND.STORY}:${pa}:vault`;
    const tree = await until(async () => {
      const t = await alice.api<{ title: string; depth: number }[]>(
        `/stories/${encodeURIComponent(coord)}/tree`,
      );
      return t.length === 2 ? t : undefined;
    });
    expect(tree.map((n) => [n.title, n.depth])).toEqual([
      ["The door", 0],
      ["Door, take two", 1],
    ]);

    // cara curates: both scenes, 60s is not reachable with 2 clips so the validator warns but accepts
    const src = (e: typeof s1) => ({
      sha256: e.ingest.normalized.sha256,
      urls: [e.ingest.normalized.url],
    });
    const cut = await cara.publishCut({
      seriesSlug: "vault-series",
      episode: 1,
      title: "Ep 1",
      synopsis: "They reach the door.",
      scenes: [
        { id: s1.event.id, sha256: s1.ingest.normalized.sha256, inSec: 0, outSec: 10, payee: pa },
        { id: s2.event.id, sha256: s2.ingest.normalized.sha256, inSec: 1, outSec: 11, payee: pb },
      ],
      scenesSources: [src(s1), src(s2)],
      price: { amount: 50 },
      curatorBps: 2000,
      hostBps: 1000,
      host: pc,
      relay: relay.url,
    });
    const parsed = parseCut(cut);
    expect(parsed.durationSec).toBeCloseTo(20, 3);
    expect(parsed.hlsUrl).toContain(".m3u8");
    expect(parsed.weights.reduce((a, w) => a + w.weight, 0)).toBe(10_000);
    await cara.publishSeries({
      slug: "vault-series",
      title: "The Vault",
      summary: "A heist.",
      episodes: [1],
      freeEpisodes: 1,
    });

    const credits = await until(async () => {
      const c = await alice.api<{ role: string; percent: number; seconds: number }[]>(
        `/cuts/${cut.id}/credits`,
      );
      return c.length ? c : undefined;
    });
    expect(credits.reduce((a, c) => a + c.percent, 0)).toBeCloseTo(100);
    expect(credits.filter((c) => c.role === "creator").map((c) => c.seconds)).toEqual([10, 10]);
    expect(await alice.api(`/earnings/${pa}`)).toMatchObject({ secondsUsed: 10, episodes: 1 });
    const used = await alice.api<{ title: string; used: boolean }[]>(
      `/stories/${encodeURIComponent(coord)}/tree`,
    );
    expect(used.every((n) => n.used)).toBe(true);

    // the rendered episode plays from Blossom, and from the mirror if the origin is gone
    const hlsSha = parsed.hlsUrl?.split("/").pop()?.replace(".m3u8", "") as string;
    expect((await probe(`${A.url}/${hlsSha}.m3u8`)).durationSec).toBeCloseTo(20, 1);
    expect((await probe(`${B.url}/${hlsSha}.m3u8`)).durationSec).toBeCloseTo(20, 1);
    expect(story.id).toBeTruthy();
    expect(pc).toBeTruthy();
  }, 300_000);

  test("forking a scene under a non-fork-friendly license is refused", async () => {
    const alice = mk(LocalSigner.generate());
    const bob = mk(LocalSigner.generate());
    const pa = await alice.me();
    await alice.createStory({ d: "closed", title: "Closed", logline: "x" });
    const bytes = new Uint8Array(
      await Bun.file(await makeClip(join(dir, "c.mp4"), { sec: 12 })).arrayBuffer(),
    );
    const s = await alice.publishScene({
      bytes,
      title: "No fork",
      prompt: "p",
      story: { pubkey: pa, d: "closed" },
      license: "All-Rights-Reserved",
    });
    await expect(bob.forkScene(s.event, { bytes, title: "x", prompt: "y" })).rejects.toThrow(
      /does not allow forking/,
    );
  }, 120_000);

  test("an invalid event is never published", async () => {
    const alice = mk(LocalSigner.generate());
    // a Cut with a tampered split is caught before it reaches a relay
    await expect(
      alice.publishCut({
        seriesSlug: "x",
        episode: 1,
        title: "t",
        synopsis: "s",
        scenes: [
          {
            id: "a".repeat(64),
            sha256: "b".repeat(64),
            inSec: 5,
            outSec: 5,
            payee: "c".repeat(64),
          },
        ],
        scenesSources: [{ sha256: "b".repeat(64), urls: [] }],
        price: { amount: 1 },
        curatorBps: 0,
        hostBps: 0,
        host: "c".repeat(64),
        render: false,
      }),
    ).rejects.toThrow();
  });
});
