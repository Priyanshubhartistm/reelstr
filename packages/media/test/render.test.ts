import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureLoudness, normalizeScene, probe, renderEpisode, run } from "../src";
import { makeClip, tmp } from "./helpers";

/** First and last packet times of one stream (ffprobe reports N/A for HLS stream durations). */
async function span(
  path: string,
  which: "v" | "a",
  extra: string[] = [],
): Promise<{ start: number; end: number }> {
  const { stdout } = await run("ffprobe", [
    ...extra,
    "-v",
    "error",
    "-select_streams",
    `${which}:0`,
    "-show_entries",
    "packet=pts_time,duration_time",
    "-of",
    "csv=p=0",
    path,
  ]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((l) => l.split(",").map(Number));
  const last = rows.at(-1) ?? [0, 0];
  return { start: rows[0]?.[0] ?? 0, end: (last[0] ?? 0) + (last[1] ?? 0) };
}

async function scenes(d: string, n = 2, sec = 4) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const src = await makeClip(join(d, `raw${i}.mp4`), {
      size: "360x640",
      fps: 30,
      sec,
      freq: 300 + i * 200,
      gainDb: -20 - i * 6,
      pattern: i % 2 ? "testsrc2" : "smptebars",
    });
    const norm = join(d, `n${i}.mp4`);
    await normalizeScene(src, norm);
    out.push(norm);
  }
  return out;
}

describe("renderEpisode (BE-2)", () => {
  test("HLS ladder: 2 s segments, 3 rungs, duration = sum of trims, A/V aligned, -14 LUFS", async () => {
    const d = tmp();
    const [a, b] = await scenes(d);
    const r = await renderEpisode({
      scenes: [
        { path: a as string, inSec: 0.5, outSec: 3.5 },
        { path: b as string, inSec: 0, outSec: 4 },
      ],
      outDir: join(d, "ep"),
    });
    expect(r.durationSec).toBeCloseTo(7, 3);
    const master = readFileSync(join(d, "ep", r.master), "utf8");
    expect(master.match(/#EXT-X-STREAM-INF/g)?.length).toBe(3);
    expect(master).toContain("RESOLUTION=1080x1920");
    expect(master).toContain("RESOLUTION=480x854");
    const pl = readFileSync(join(d, "ep", "v0", "index.m3u8"), "utf8");
    expect(pl).toContain("#EXT-X-TARGETDURATION:2");
    expect(pl).toContain("#EXT-X-ENDLIST");
    expect(pl).toContain("#EXT-X-MAP");
    // decode the top rung and check duration, stream lengths and loudness
    const p = await probe(join(d, "ep", "v0", "index.m3u8"));
    expect(p.durationSec).toBeCloseTo(7, 1);
    expect(p.video?.height).toBe(1920);
    const v = await span(join(d, "ep", "v0", "index.m3u8"), "v");
    const au = await span(join(d, "ep", "v0", "index.m3u8"), "a");
    // video is exactly 7 s of frames; audio may lead by one AAC priming frame (~21 ms) and pad the tail
    expect(Math.abs(v.end - v.start - 7)).toBeLessThan(1 / 30 + 0.001);
    expect(Math.abs(au.start - v.start)).toBeLessThan(0.05);
    expect(Math.abs(au.end - v.end)).toBeLessThan(0.08);
    const l = await measureLoudness(join(d, "ep", "v0", "index.m3u8"));
    expect(Math.abs(l.i + 14)).toBeLessThanOrEqual(1);
    for (const f of r.files.filter((x) => x.path.endsWith(".m4s")))
      expect(f.bytes).toBeGreaterThan(0);
  }, 180_000);

  test("same inputs -> identical rendition hash; different trim -> different", async () => {
    const d = tmp();
    const [a, b] = await scenes(d, 2, 3);
    const mk = (out: string, outSec = 3) =>
      renderEpisode({
        scenes: [
          { path: a as string, inSec: 0, outSec: 3 },
          { path: b as string, inSec: 0, outSec },
        ],
        outDir: join(d, out),
      });
    const r1 = await mk("e1");
    const r2 = await mk("e2");
    const r3 = await mk("e3", 2.5);
    expect(r1.renditionHash).toBe(r2.renditionHash);
    expect(r3.renditionHash).not.toBe(r1.renditionHash);
  }, 240_000);

  test("audio bed is mixed in and keeps the episode at -14 LUFS", async () => {
    const d = tmp();
    const [a] = await scenes(d, 1, 4);
    const bed = await makeClip(join(d, "bed.mp4"), { freq: 120, gainDb: -10, sec: 2 });
    const r = await renderEpisode({
      scenes: [{ path: a as string, inSec: 0, outSec: 4 }],
      audioBed: { path: bed },
      outDir: join(d, "ep"),
    });
    const l = await measureLoudness(join(d, "ep", "v0", "index.m3u8"));
    expect(Math.abs(l.i + 14)).toBeLessThanOrEqual(1);
    expect(r.durationSec).toBeCloseTo(4, 3);
  }, 120_000);

  test("AES-128: segments are encrypted, playlist names the key, key is not in the output, decrypts with the key", async () => {
    const d = tmp();
    const [a] = await scenes(d, 1, 4);
    const key = new Uint8Array(16).map((_, i) => i + 1);
    const iv = new Uint8Array(16).map((_, i) => 255 - i);
    const keyPath = join(d, "served.key");
    await Bun.write(keyPath, key);
    const r = await renderEpisode({
      scenes: [{ path: a as string, inSec: 0, outSec: 4 }],
      outDir: join(d, "ep"),
      encryption: { key, iv, keyUri: `file://${keyPath}` },
    });
    const pl = readFileSync(join(d, "ep", "v2", "index.m3u8"), "utf8");
    expect(pl).toContain("#EXT-X-KEY:METHOD=AES-128");
    expect(pl).toContain(`URI="file://${keyPath}"`);
    expect(r.files.some((f) => /enc\.key|keyinfo/.test(f.path))).toBe(false);
    // raw bytes are not a parsable mp4 without decryption
    const seg = join(d, "ep", "v2", "seg_00000.ts");
    await expect(run("ffprobe", ["-v", "error", seg])).rejects.toThrow();
    // with the key the playlist decodes
    const dec = await span(join(d, "ep", "v2", "index.m3u8"), "v", ["-allowed_extensions", "ALL"]);
    expect(dec.end - dec.start).toBeCloseTo(4, 1);
  }, 120_000);

  test("no A/V drift across many joins (8 scenes)", async () => {
    const d = tmp();
    const [a, b] = await scenes(d, 2, 4);
    const cuts = Array.from({ length: 8 }, (_, i) => ({
      path: (i % 2 ? b : a) as string,
      inSec: 0.2 * (i % 3),
      outSec: 2.2 + 0.2 * (i % 3),
    }));
    const r = await renderEpisode({ scenes: cuts, outDir: join(d, "ep") });
    const v = await span(join(d, "ep", "v1", "index.m3u8"), "v");
    const au = await span(join(d, "ep", "v1", "index.m3u8"), "a");
    expect(Math.abs(v.end - v.start - r.durationSec)).toBeLessThan(1 / 30 + 0.001);
    // the concat filter drifted ~65 ms per join (0.5 s over 8); sample-exact mixing keeps this at one AAC frame
    expect(Math.abs(au.end - v.end)).toBeLessThan(0.05);
    expect(Math.abs(au.start - v.start)).toBeLessThan(0.05);
  }, 240_000);

  test("rejects bad input", async () => {
    const d = tmp();
    const [a] = await scenes(d, 1, 2);
    await expect(renderEpisode({ scenes: [], outDir: join(d, "x") })).rejects.toThrow(/no scenes/);
    await expect(
      renderEpisode({ scenes: [{ path: a as string, inSec: 1, outSec: 1 }], outDir: join(d, "x") }),
    ).rejects.toThrow(/after in/);
    await expect(
      renderEpisode({
        scenes: [{ path: a as string, inSec: 0, outSec: 1 }],
        outDir: join(d, "x"),
        encryption: { key: new Uint8Array(5), iv: new Uint8Array(16), keyUri: "k" },
      }),
    ).rejects.toThrow(/16 bytes/);
  }, 60_000);
});
