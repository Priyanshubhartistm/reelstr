import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BlossomClient, fetchVerified } from "@reelstr/blossom";
import { checkNormalized, probe } from "@reelstr/media";
import { LocalSigner } from "@reelstr/nostr";
import { sha256Hex } from "@reelstr/protocol";
import { cleanup, startBlossom, tempDir } from "@reelstr/testkit";
import { makeClip } from "../../../packages/media/test/helpers";
import { ingestScene, mirrorBlobs, publishHls, renderAndPublish } from "../src";

let A: Awaited<ReturnType<typeof startBlossom>>;
let B: Awaited<ReturnType<typeof startBlossom>>;
const signer = LocalSigner.generate();
let ca: BlossomClient;
let cb: BlossomClient;

beforeAll(async () => {
  A = await startBlossom();
  B = await startBlossom();
  ca = new BlossomClient(A.url, signer);
  cb = new BlossomClient(B.url, signer);
}, 60_000);
afterAll(cleanup);

const upload = async (path: string) => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const d = await ca.upload(bytes, "video/mp4");
  return { sha256: d.sha256, urls: [d.url] };
};

describe("media service pipeline (BE-1, BE-2, BE-8)", () => {
  const dir = tempDir();
  const scenes: { sha256: string; urls: string[] }[] = [];

  test("ingestScene: fetch by hash, normalize, store original and normalized", async () => {
    for (let i = 0; i < 2; i++) {
      const raw = await makeClip(join(dir, `raw${i}.mp4`), {
        size: "640x360",
        fps: 24,
        sec: 4,
        freq: 300 + i * 250,
        gainDb: -26 + i * 8,
      });
      const src = await upload(raw);
      const r = await ingestScene(src, { primary: ca, mirrors: [] });
      expect(r.original.sha256).toBe(src.sha256);
      expect(r.normalized.sha256).not.toBe(src.sha256);
      expect(r.probe.video?.width).toBe(1080);
      // a JPEG poster frame is stored with the scene (Divine's relay refuses a video event without one)
      const poster = await fetchVerified([r.thumbnail.url], r.thumbnail.sha256);
      expect([poster.bytes[0], poster.bytes[1]]).toEqual([0xff, 0xd8]);
      const got = await fetchVerified([r.normalized.url], r.normalized.sha256);
      const p = join(dir, `norm${i}.mp4`);
      await Bun.write(p, got.bytes);
      expect(await checkNormalized(p)).toEqual([]);
      scenes.push({ sha256: r.normalized.sha256, urls: [r.normalized.url] });
    }
  }, 180_000);

  let published: Awaited<ReturnType<typeof renderAndPublish>>;
  test("renderAndPublish: content-addressed HLS that plays straight from Blossom", async () => {
    published = await renderAndPublish(
      {
        scenes: [
          { ...(scenes[0] as (typeof scenes)[0]), inSec: 0.5, outSec: 3.5 },
          { ...(scenes[1] as (typeof scenes)[0]), inSec: 0, outSec: 4 },
        ],
      },
      { primary: ca, mirrors: [] },
    );
    expect(published.durationSec).toBeCloseTo(7, 3);
    expect(published.masterUrl).toContain(published.masterSha256);
    const p = await probe(`${A.url}/${published.masterSha256}.m3u8`);
    expect(p.video?.height).toBe(1920);
    expect(p.durationSec).toBeCloseTo(7, 1);
  }, 240_000);

  test("every playlist reference is the SHA-256 of the blob it names", async () => {
    const master = await (await fetch(`${A.url}/${published.masterSha256}.m3u8`)).text();
    const variants = master.split("\n").filter((l) => l.endsWith(".m3u8"));
    expect(variants.length).toBe(3);
    for (const v of variants) {
      const body = new Uint8Array(await (await fetch(`${A.url}/${v}`)).arrayBuffer());
      expect(sha256Hex(body)).toBe(v.replace(".m3u8", ""));
      const pl = new TextDecoder().decode(body);
      const refs = [...pl.matchAll(/^([0-9a-f]{64})\.(m4s)$/gm)].map((m) => m[0]);
      expect(refs.length).toBeGreaterThan(2);
      const mapRef = pl.match(/URI="([0-9a-f]{64})\.mp4"/)?.[1];
      expect(mapRef).toBeTruthy();
      for (const r of refs.slice(0, 2)) {
        const seg = new Uint8Array(await (await fetch(`${A.url}/${r}`)).arrayBuffer());
        expect(sha256Hex(seg)).toBe(r.split(".")[0] as string);
      }
    }
  }, 60_000);

  test("mirror to the curator's server; episode still plays with the original server offline", async () => {
    const r = await mirrorBlobs(
      published.blobs.map((b) => ({
        sha256: b.sha256,
        urls: [`${A.url}/${b.sha256}`],
        type: "application/octet-stream",
      })),
      cb,
    );
    expect(r.failed).toEqual([]);
    expect(r.ok.length).toBe(published.blobs.length);
    A.stop();
    await Bun.sleep(300);
    const p = await probe(`${B.url}/${published.masterSha256}.m3u8`);
    expect(p.durationSec).toBeCloseTo(7, 1);
    expect(p.video?.width).toBe(1080);
  }, 120_000);

  test("encrypted episode: playlist names the key, segments are opaque, key is not published", async () => {
    const A2 = await startBlossom();
    const c2 = new BlossomClient(A2.url, signer);
    const key = new Uint8Array(16).map((_, i) => i * 7 + 1);
    const iv = new Uint8Array(16).map((_, i) => i + 9);
    // own scene on its own server: the first server was killed by the mirror test
    const raw = await makeClip(join(dir, "enc-raw.mp4"), { size: "360x640", fps: 30, sec: 4 });
    const up = await c2.upload(new Uint8Array(await Bun.file(raw).arrayBuffer()), "video/mp4");
    const d = (
      await ingestScene({ sha256: up.sha256, urls: [up.url] }, { primary: c2, mirrors: [] })
    ).normalized;
    const r = await renderAndPublish(
      {
        scenes: [{ sha256: d.sha256, urls: [d.url], inSec: 0, outSec: 3 }],
        encryption: { key, iv, keyUri: "https://keys.example/ep/test" },
      },
      { primary: c2, mirrors: [] },
    );
    const master = await (await fetch(`${A2.url}/${r.masterSha256}.m3u8`)).text();
    const v = master.split("\n").find((l) => l.endsWith(".m3u8")) as string;
    const pl = await (await fetch(`${A2.url}/${v}`)).text();
    expect(pl).toContain('#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/ep/test"');
    const seg = pl.split("\n").find((l) => l.endsWith(".ts")) as string;
    const segBytes = new Uint8Array(await (await fetch(`${A2.url}/${seg}`)).arrayBuffer());
    expect(segBytes[0]).not.toBe(0x47); // a clear MPEG-TS packet starts with sync byte 0x47
    for (const b of r.blobs) expect(b.name).not.toMatch(/key/);
    const keyHex = Buffer.from(key).toString("hex");
    expect(Buffer.from(segBytes).toString("hex").includes(keyHex)).toBe(false);
  }, 240_000);

  test("publishHls is deterministic: same tree uploads to the same master hash", async () => {
    // the rendition hash test in packages/media proves bit-stable output; here, same bytes -> same blob hashes
    const dirA = tempDir();
    await Bun.write(
      join(dirA, "master.m3u8"),
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv0/index.m3u8\n",
    );
    await Bun.write(
      join(dirA, "v0/index.m3u8"),
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg_00000.m4s\n#EXT-X-ENDLIST\n',
    );
    await Bun.write(join(dirA, "v0/init.mp4"), "init");
    await Bun.write(join(dirA, "v0/seg_00000.m4s"), "seg");
    const C = await startBlossom();
    const cc = new BlossomClient(C.url, signer);
    const one = await publishHls(dirA, { primary: cc, mirrors: [] });
    const two = await publishHls(dirA, { primary: cc, mirrors: [] });
    expect(one.masterSha256).toBe(two.masterSha256);
    const pl = await (
      await fetch(`${C.url}/${one.blobs.find((b) => b.name === "v0/index.m3u8")?.sha256}.m3u8`)
    ).text();
    expect(pl).toContain(`URI="${sha256Hex(new TextEncoder().encode("init"))}.mp4"`);
    expect(pl).toContain(`${sha256Hex(new TextEncoder().encode("seg"))}.m4s`);
  }, 60_000);
});
