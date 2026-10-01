import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { asrAvailable, captionScenes, run, toVtt } from "../src";
import { tmp } from "./helpers";

const have = await asrAvailable();

/** A clip whose audio is synthesized speech (espeak-ng) over a plain video. */
async function speechClip(path: string, text: string) {
  const wav = `${path}.wav`;
  await run("espeak-ng", ["-v", "en-us", "-s", "150", text, "-w", wav]);
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=360x640:r=24:d=8",
    "-i",
    wav,
    "-af",
    "apad=pad_dur=8",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path,
  ]);
  return path;
}

describe("toVtt", () => {
  test("formats cue times", () => {
    expect(toVtt([{ start: 0.5, end: 3661.25, text: "hi" }])).toBe(
      "WEBVTT\n\n00:00:00.500 --> 01:01:01.250\nhi\n",
    );
  });
});

describe.skipIf(!have)("caption generation (local whisper, real speech audio)", () => {
  test("transcribes trimmed scenes and times cues against the episode", async () => {
    const d = tmp();
    const a = await speechClip(join(d, "a.mp4"), "The vault door is made of steel.");
    const b = await speechClip(join(d, "b.mp4"), "Rain falls on the roof.");
    const { cues, language } = await captionScenes([
      { path: a, inSec: 0, outSec: 6 },
      { path: b, inSec: 0, outSec: 6 },
    ]);
    expect(language).toBe("en");
    const text = cues.map((c) => c.text.toLowerCase()).join(" ");
    expect(text).toContain("steel");
    expect(text).toContain("rain");
    // scene two's speech lands after scene one's 6 s, not at zero
    const rain = cues.find((c) => c.text.toLowerCase().includes("rain"));
    expect(rain?.start).toBeGreaterThanOrEqual(6);
    expect(rain?.end).toBeLessThanOrEqual(12.01);
    expect(cues[0]?.start).toBeLessThan(3);
  }, 180_000);

  test("a scene with no audio track contributes no cues but still advances the clock", async () => {
    const d = tmp();
    const mute = join(d, "mute.mp4");
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=360x640:r=24:d=5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      mute,
    ]);
    const talk = await speechClip(join(d, "t.mp4"), "Nobody is coming.");
    const { cues } = await captionScenes([
      { path: mute, inSec: 0, outSec: 5 },
      { path: talk, inSec: 0, outSec: 6 },
    ]);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.start).toBeGreaterThanOrEqual(5);
  }, 180_000);
});
