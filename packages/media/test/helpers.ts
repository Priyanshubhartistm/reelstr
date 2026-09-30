import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src";

export const tmp = () => mkdtempSync(join(tmpdir(), "reelstr-media-"));

/** Synthetic test clip: moving pattern + sine tone at `gainDb`. No audio if gainDb is null. */
export async function makeClip(
  path: string,
  o: {
    size?: string;
    fps?: number;
    sec?: number;
    freq?: number;
    gainDb?: number | null;
    pattern?: string;
  } = {},
) {
  const { size = "640x360", fps = 24, sec = 3, freq = 440, gainDb = -24, pattern = "testsrc2" } = o;
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `${pattern}=size=${size}:rate=${fps}:duration=${sec}`,
  ];
  if (gainDb !== null)
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${freq}:duration=${sec}:sample_rate=44100`,
      "-af",
      `volume=${gainDb}dB`,
      "-c:a",
      "aac",
    );
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", path);
  await run("ffmpeg", args);
  return path;
}
