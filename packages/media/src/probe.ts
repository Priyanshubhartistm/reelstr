import { run } from "./run";

export interface Probe {
  durationSec: number;
  video?: {
    codec: string;
    profile: string;
    width: number;
    height: number;
    pixFmt: string;
    /** stream r_frame_rate and avg_frame_rate as numbers; equal means constant frame rate */
    rFps: number;
    avgFps: number;
  };
  audio?: { codec: string; sampleRate: number; channels: number };
}

const frac = (s: string | undefined): number => {
  if (!s) return 0;
  const [a, b] = s.split("/").map(Number);
  return b ? (a ?? 0) / b : (a ?? 0);
};

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  const j = JSON.parse(stdout) as {
    format: { duration?: string };
    streams: Record<string, string | number>[];
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(j.format.duration ?? 0),
    video: v && {
      codec: String(v.codec_name),
      profile: String(v.profile ?? ""),
      width: Number(v.width),
      height: Number(v.height),
      pixFmt: String(v.pix_fmt),
      rFps: frac(String(v.r_frame_rate)),
      avgFps: frac(String(v.avg_frame_rate)),
    },
    audio: a && {
      codec: String(a.codec_name),
      sampleRate: Number(a.sample_rate),
      channels: Number(a.channels),
    },
  };
}

export interface Loudness {
  /** integrated loudness, LUFS */
  i: number;
  /** true peak, dBTP */
  tp: number;
  lra: number;
  thresh: number;
  offset: number;
}

/** First pass of EBU R128 loudnorm: measure only. */
export async function measureLoudness(path: string, inputArgs: string[] = []): Promise<Loudness> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    ...inputArgs,
    "-i",
    path,
    "-vn",
    "-af",
    "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
    "-f",
    "null",
    "-",
  ]);
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (!m) throw new Error("could not parse loudnorm output");
  const j = JSON.parse(m[0]) as Record<string, string>;
  return {
    i: Number(j.input_i),
    tp: Number(j.input_tp),
    lra: Number(j.input_lra),
    thresh: Number(j.input_thresh),
    offset: Number(j.target_offset),
  };
}

/**
 * Static gain (dB) that brings a measured clip to the target loudness without exceeding the
 * true-peak ceiling. Silent input (measured near -70 LUFS or lower) is left alone. Replaces
 * loudnorm's second pass, which dropped up to ~70 ms of tail audio on some inputs (measured), so
 * audio ended before its video and left a gap at scene joins.
 */
export function gainFor(
  m: { i: number; tp: number },
  targetLufs: number,
  ceilingDbtp: number,
): number {
  if (!Number.isFinite(m.i) || m.i < -60) return 0;
  const want = targetLufs - m.i;
  const room = ceilingDbtp - m.tp; // how much we can raise before the true peak passes the ceiling
  return Math.round(Math.min(want, room) * 1000) / 1000;
}
