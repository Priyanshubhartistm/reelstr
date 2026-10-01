import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkNormalized, hashFile, measureLoudness, normalizeScene, probe } from "../src";
import { makeClip, tmp } from "./helpers";

describe("normalizeScene (BE-1)", () => {
  test("landscape 24 fps quiet clip -> 1080x1920 30 fps CFR -14 LUFS (crop)", async () => {
    const d = tmp();
    const src = await makeClip(join(d, "in.mp4"), { size: "640x360", fps: 24, gainDb: -30 });
    const out = join(d, "out.mp4");
    const p = await normalizeScene(src, out);
    expect(p.video?.width).toBe(1080);
    expect(p.video?.height).toBe(1920);
    expect(await checkNormalized(out)).toEqual([]);
  }, 60_000);

  test("letterbox keeps the whole frame", async () => {
    const d = tmp();
    const src = await makeClip(join(d, "in.mp4"), { size: "640x360" });
    const out = join(d, "out.mp4");
    await normalizeScene(src, out, { fit: "letterbox" });
    expect(await checkNormalized(out)).toEqual([]);
  }, 60_000);

  test("clip with no audio gets a silent stereo 48k track", async () => {
    const d = tmp();
    const src = await makeClip(join(d, "in.mp4"), { gainDb: null });
    const out = join(d, "out.mp4");
    const p = await normalizeScene(src, out);
    expect(p.audio).toEqual({ codec: "aac", sampleRate: 48000, channels: 2 });
    expect(await checkNormalized(out)).toEqual([]);
  }, 60_000);

  test("rejects inputs over the 20 s cap", async () => {
    const d = tmp();
    const src = await makeClip(join(d, "long.mp4"), { sec: 21, size: "160x90", fps: 10 });
    await expect(normalizeScene(src, join(d, "o.mp4"))).rejects.toThrow(/limit is 20s/);
  }, 60_000);

  test("loud and quiet scenes land within 1 LU of each other (NFR)", async () => {
    const d = tmp();
    const quiet = await makeClip(join(d, "q.mp4"), { gainDb: -34, freq: 300 });
    const loud = await makeClip(join(d, "l.mp4"), { gainDb: -8, freq: 900 });
    await normalizeScene(quiet, join(d, "nq.mp4"));
    await normalizeScene(loud, join(d, "nl.mp4"));
    const a = await measureLoudness(join(d, "nq.mp4"));
    const b = await measureLoudness(join(d, "nl.mp4"));
    expect(Math.abs(a.i - b.i)).toBeLessThanOrEqual(1);
  }, 90_000);

  test("same input, same bytes (needed for hash-stable renditions)", async () => {
    const d = tmp();
    const src = await makeClip(join(d, "in.mp4"));
    await normalizeScene(src, join(d, "a.mp4"));
    await normalizeScene(src, join(d, "b.mp4"));
    expect(await hashFile(join(d, "a.mp4"))).toBe(await hashFile(join(d, "b.mp4")));
    expect((await probe(join(d, "a.mp4"))).durationSec).toBeCloseTo(3, 1);
  }, 60_000);
});

import { gainFor, run } from "../src";

describe("audio length and loudness gain (regression: loudnorm dropped tail audio)", () => {
  test("every normalized scene keeps audio as long as its video, for several tones and levels", async () => {
    const d = tmp();
    for (const [i, [freq, gain]] of (
      [
        [300, -18],
        [450, -18],
        [600, -18],
        [750, -18],
        [1000, -30],
        [180, -12],
      ] as const
    ).entries()) {
      const raw = await makeClip(join(d, `r${i}.mp4`), {
        size: "360x640",
        fps: 30,
        sec: 6,
        freq,
        gainDb: gain,
      });
      const out = join(d, `n${i}.mp4`);
      await normalizeScene(raw, out);
      const { stdout } = await run("ffmpeg", [
        "-v",
        "error",
        "-i",
        out,
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-progress",
        "pipe:1",
        "-nostats",
        "-",
      ]);
      const audioSec =
        ([...stdout.matchAll(/out_time_us=(\d+)/g)].map((m) => Number(m[1])).at(-1) ?? 0) / 1e6;
      // AAC adds <= ~one frame of priming/padding; losing 60+ ms of tail was the bug
      expect(audioSec).toBeGreaterThanOrEqual(5.99);
      expect(audioSec).toBeLessThan(6.04);
    }
  }, 180_000);

  test("gainFor: reaches the target, respects the true-peak ceiling, leaves silence alone", () => {
    expect(gainFor({ i: -30, tp: -20 }, -14, -1)).toBe(16);
    expect(gainFor({ i: -20, tp: -3 }, -14, -1)).toBe(2); // wants +6 but only 2 dB of headroom
    expect(gainFor({ i: -70, tp: -80 }, -14, -1)).toBe(0);
    expect(gainFor({ i: Number.NEGATIVE_INFINITY, tp: -80 }, -14, -1)).toBe(0);
  });
});
