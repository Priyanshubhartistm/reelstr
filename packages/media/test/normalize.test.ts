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
