import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { normalizeScene, probe, renderEpisode, run } from "../src";
import { makeClip, tmp } from "./helpers";

// Measured on this machine (12 cores). Thresholds are the PRD's targets; the numbers are printed so a
// slower machine shows how far off it is instead of just failing.
describe("media performance targets", () => {
  test("BE-1 normalize a 12 s clip, and BE-2 render a 2-minute episode in under 60 s", async () => {
    const d = tmp();
    const norm: string[] = [];
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      const raw = await makeClip(join(d, `r${i}.mp4`), {
        size: "720x1280",
        fps: 30,
        sec: 12,
        freq: 220 + i * 60,
        gainDb: -22 - (i % 3) * 4,
        pattern: i % 2 ? "testsrc2" : "smptebars",
      });
      const t = performance.now();
      const out = join(d, `n${i}.mp4`);
      await normalizeScene(raw, out);
      if (i === 0)
        console.log(
          `normalize 12 s 720x1280 clip: ${((performance.now() - t) / 1000).toFixed(1)} s`,
        );
      norm.push(out);
    }
    console.log(`10 clips made + normalized: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    const t1 = performance.now();
    const r = await renderEpisode({
      scenes: norm.map((p) => ({ path: p, inSec: 0, outSec: 12 })),
      outDir: join(d, "ep"),
    });
    const secs = (performance.now() - t1) / 1000;
    console.log(
      `render 120 s episode (3-rung HLS ladder): ${secs.toFixed(1)} s, ${r.files.length} files`,
    );
    expect(r.durationSec).toBeCloseTo(120, 2);
    expect(secs).toBeLessThan(60); // BE-2 acceptance: ready < 60 s after publish for a 2-minute episode
  }, 600_000);

  test("NFR: no audible gap at scene joins: silence around each join is at most 20 ms", async () => {
    const d = tmp();
    const norm: string[] = [];
    for (let i = 0; i < 4; i++) {
      const raw = await makeClip(join(d, `r${i}.mp4`), {
        size: "360x640",
        fps: 30,
        sec: 6,
        freq: 300 + i * 150,
        gainDb: -18,
      });
      const out = join(d, `n${i}.mp4`);
      await normalizeScene(raw, out);
      norm.push(out);
    }
    const r = await renderEpisode({
      scenes: norm.map((p) => ({ path: p, inSec: 0, outSec: 6 })),
      outDir: join(d, "ep"),
    });
    // decode the top rung's audio to raw float and look for runs of near-silence (below -50 dBFS)
    const pcm = join(d, "a.f32");
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      join(d, "ep", "v0", "index.m3u8"),
      "-vn",
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      "48000",
      pcm,
    ]);
    const samples = new Float32Array(await Bun.file(pcm).arrayBuffer());
    const floor = 10 ** (-50 / 20);
    let run0 = 0;
    let longest = 0;
    const joinsAt = [6, 12, 18].map((s) => s * 48000);
    for (let i = 1500; i < samples.length - 1500; i++) {
      // skip encoder priming at the very start and tail
      if (Math.abs(samples[i] as number) < floor) {
        run0++;
      } else {
        // only count silent runs that sit on a join (within 100 ms)
        if (run0 > 0 && joinsAt.some((j) => Math.abs(i - j) < 4800))
          longest = Math.max(longest, run0);
        run0 = 0;
      }
    }
    const ms = (longest / 48000) * 1000;
    console.log(
      `longest near-silent run at a join: ${ms.toFixed(1)} ms (${r.durationSec} s episode)`,
    );
    expect(ms).toBeLessThanOrEqual(20);
    expect((await probe(join(d, "ep", "v0", "index.m3u8"))).durationSec).toBeCloseTo(24, 0);
  }, 300_000);
});
