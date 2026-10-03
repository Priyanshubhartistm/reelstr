import { gainFor, measureLoudness, type Probe, probe } from "./probe";
import { run } from "./run";

export const TARGET = {
  width: 1080,
  height: 1920,
  fps: 30,
  lufs: -14,
  truePeak: -1,
  sampleRate: 48000,
} as const;

export interface NormalizeOptions {
  /** landscape/odd-aspect inputs: crop to fill, or letterbox (creator's choice) */
  fit?: "crop" | "letterbox";
  /** scenes are 10-15 s, upload cap 20 s (FE-2) */
  maxDurationSec?: number;
}

/** Filters that make output bit-for-bit reproducible on the same ffmpeg build. */
export const deterministic = (threads = 1) => [
  "-map_metadata",
  "-1",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
  "-threads",
  String(threads),
];
export const DETERMINISTIC = deterministic(1);

export const videoFilter = (fit: "crop" | "letterbox") =>
  (fit === "crop"
    ? `scale=${TARGET.width}:${TARGET.height}:force_original_aspect_ratio=increase,crop=${TARGET.width}:${TARGET.height}`
    : `scale=${TARGET.width}:${TARGET.height}:force_original_aspect_ratio=decrease,pad=${TARGET.width}:${TARGET.height}:(ow-iw)/2:(oh-ih)/2:black`) +
  `,fps=${TARGET.fps},setsar=1,format=yuv420p`;

/**
 * BE-1: transcode to 1080x1920, 30 fps CFR, H.264 High, AAC 48 kHz stereo, -14 LUFS / -1 dBTP
 * (measured, then a static gain). Inputs with no audio get a silent track so later concats never drop audio.
 */
export async function normalizeScene(
  input: string,
  output: string,
  opts: NormalizeOptions = {},
): Promise<Probe> {
  const src = await probe(input);
  if (!src.video) throw new Error("input has no video stream");
  const max = opts.maxDurationSec ?? 20;
  if (src.durationSec > max + 0.05)
    throw new Error(`input is ${src.durationSec.toFixed(1)}s, limit is ${max}s`);

  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", input];
  let audioFilter = "";
  if (src.audio) {
    const m = await measureLoudness(input);
    audioFilter =
      `volume=${gainFor(m, TARGET.lufs, TARGET.truePeak)}dB,` +
      `aresample=${TARGET.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  } else {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=${TARGET.sampleRate}`,
    );
  }
  args.push(
    "-map",
    "0:v:0",
    "-map",
    src.audio ? "0:a:0" : "1:a:0",
    "-vf",
    videoFilter(opts.fit ?? "crop"),
    ...(audioFilter ? ["-af", audioFilter] : []),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-maxrate",
    "8M",
    "-bufsize",
    "16M",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(TARGET.fps * 2),
    "-keyint_min",
    String(TARGET.fps * 2),
    "-sc_threshold",
    "0",
    "-fps_mode",
    "cfr",
    "-r",
    String(TARGET.fps),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    String(TARGET.sampleRate),
    "-ac",
    "2",
    "-t",
    String(src.durationSec),
    "-movflags",
    "+faststart",
    ...DETERMINISTIC,
    output,
  );
  await run("ffmpeg", args);
  return probe(output);
}

/** ffprobe/loudness conformance check; returns human-readable violations (empty = conforms). */
export async function checkNormalized(path: string, lufsToleranceLU = 1): Promise<string[]> {
  const p = await probe(path);
  const bad: string[] = [];
  const v = p.video;
  if (!v) return ["no video stream"];
  if (v.width !== TARGET.width || v.height !== TARGET.height)
    bad.push(`size ${v.width}x${v.height}`);
  if (v.codec !== "h264") bad.push(`video codec ${v.codec}`);
  if (v.profile !== "High") bad.push(`profile ${v.profile}`);
  if (v.pixFmt !== "yuv420p") bad.push(`pix_fmt ${v.pixFmt}`);
  if (Math.abs(v.rFps - TARGET.fps) > 0.001 || Math.abs(v.avgFps - TARGET.fps) > 0.001)
    bad.push(`fps r=${v.rFps} avg=${v.avgFps} (need constant ${TARGET.fps})`);
  const a = p.audio;
  if (!a) return [...bad, "no audio stream"];
  if (a.codec !== "aac") bad.push(`audio codec ${a.codec}`);
  if (a.sampleRate !== TARGET.sampleRate) bad.push(`sample rate ${a.sampleRate}`);
  if (a.channels !== 2) bad.push(`channels ${a.channels}`);
  const l = await measureLoudness(path);
  // digital silence measures as -70 LUFS; a silent padded clip is allowed
  if (l.i > -60 && Math.abs(l.i - TARGET.lufs) > lufsToleranceLU) bad.push(`loudness ${l.i} LUFS`);
  if (l.tp > TARGET.truePeak + 0.3) bad.push(`true peak ${l.tp} dBTP`);
  return bad;
}

/**
 * A JPEG poster frame (540 px wide) from a clip. NIP-71 readers show it before play, and some relays
 * (Divine's) refuse a video event that has none. Taken half a second in, or the middle of a shorter clip.
 */
export async function posterFrame(input: string, output: string): Promise<void> {
  const { durationSec } = await probe(input);
  const at = Math.min(0.5, durationSec / 2);
  await run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(at),
    "-i",
    input,
    "-frames:v",
    "1",
    "-vf",
    "scale=540:-2",
    "-q:v",
    "4",
    output,
  ]);
}
