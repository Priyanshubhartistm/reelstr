import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DETERMINISTIC, TARGET } from "./normalize";
import { measureLoudness, probe } from "./probe";
import { hashFile, run } from "./run";

export interface RenderScene {
  /** a normalized scene (see normalizeScene): 1080x1920 30 fps with an audio track */
  path: string;
  inSec: number;
  outSec: number;
}

export interface Rung {
  name: string;
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
}

/** 1080/720/480 portrait ladder (Apple's H.264 recommendations for 1080p/720p/540p-class bitrates). */
export const DEFAULT_LADDER: Rung[] = [
  { name: "1080", width: 1080, height: 1920, videoKbps: 4500, audioKbps: 128 },
  { name: "720", width: 720, height: 1280, videoKbps: 2000, audioKbps: 128 },
  { name: "480", width: 480, height: 854, videoKbps: 1100, audioKbps: 96 },
];

export interface RenderOptions {
  scenes: RenderScene[];
  audioBed?: { path: string; gainDb?: number };
  outDir: string;
  segmentSec?: number;
  ladder?: Rung[];
  /** AES-128: `keyUri` is written into the playlists; the key itself is never written to outDir. */
  encryption?: { key: Uint8Array; iv: Uint8Array; keyUri: string };
}

export interface RenderedFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface RenderResult {
  master: string;
  durationSec: number;
  files: RenderedFile[];
  /** hash over every output path + content hash: equal for equal inputs */
  renditionHash: string;
}

const FADE = 0.04; // 40 ms out + 40 ms in around each join = ~80 ms dip that keeps A/V timing exact
/** Snap a time to the 30 fps frame grid so video and audio cut lengths match exactly. */
export const snap = (s: number) => Math.round(s * TARGET.fps) / TARGET.fps;
const num = (n: number) => n.toFixed(6);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export async function renderEpisode(o: RenderOptions): Promise<RenderResult> {
  if (o.scenes.length === 0) throw new Error("episode has no scenes");
  const ladder = o.ladder ?? DEFAULT_LADDER;
  const seg = o.segmentSec ?? 2;
  const cuts = o.scenes.map((s) => ({ ...s, inSec: snap(s.inSec), outSec: snap(s.outSec) }));
  for (const c of cuts) if (c.outSec <= c.inSec) throw new Error("trim out must be after in");
  for (const s of o.scenes) {
    const p = await probe(s.path);
    if (!p.video || !p.audio)
      throw new Error(`${s.path}: scene needs video and audio (normalize it first)`);
  }
  const total = cuts.reduce(
    (a, c) => a + Math.round((c.outSec - c.inSec) * TARGET.fps) / TARGET.fps,
    0,
  );
  if (o.encryption && (o.encryption.key.length !== 16 || o.encryption.iv.length !== 16))
    throw new Error("AES-128 key and iv must be 16 bytes");

  rmSync(o.outDir, { recursive: true, force: true });
  mkdirSync(o.outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "reelstr-render-"));
  try {
    // 1. audio mix in raw float PCM so every scene is exactly (out-in) * 48000 samples. The concat
    //    filter sequences whatever each segment decodes to and drifted ~80 ms per join, so the
    //    cutting, 40 ms dip fades and optional bed mix are done sample-exactly here instead.
    const SR = TARGET.sampleRate;
    const CH = 2;
    const fadeN = Math.round(FADE * SR);
    const decode = async (args: string[], samples: number): Promise<Float32Array> => {
      const p = Bun.spawn(
        [
          "ffmpeg",
          "-v",
          "error",
          ...args,
          "-f",
          "f32le",
          "-ar",
          String(SR),
          "-ac",
          String(CH),
          "-",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [buf, err, code] = await Promise.all([
        new Response(p.stdout).arrayBuffer(),
        new Response(p.stderr).text(),
        p.exited,
      ]);
      if (code !== 0)
        throw new Error(`ffmpeg decode failed: ${err.trim().split("\n").slice(-3).join("\n")}`);
      const out = new Float32Array(samples * CH); // zero-padded if the source is short
      out.set(new Float32Array(buf).subarray(0, samples * CH));
      return out;
    };
    const totalSamples = cuts.reduce((a, c) => a + Math.round((c.outSec - c.inSec) * SR), 0);
    const mix = new Float32Array(totalSamples * CH);
    let at = 0;
    for (const c of cuts) {
      const n = Math.round((c.outSec - c.inSec) * SR);
      const seg = await decode(
        ["-ss", num(c.inSec), "-i", c.path, "-map", "0:a:0", "-t", num(c.outSec - c.inSec + 0.1)],
        n,
      );
      for (let i = 0; i < Math.min(fadeN, n); i++) {
        const gin = i / fadeN;
        const gout = (fadeN - 1 - i) / fadeN;
        for (let ch = 0; ch < CH; ch++) {
          seg[i * CH + ch] = (seg[i * CH + ch] ?? 0) * gin;
          const j = n - fadeN + i;
          if (j >= 0) seg[j * CH + ch] = (seg[j * CH + ch] ?? 0) * (1 - gout);
        }
      }
      mix.set(seg, at * CH);
      at += n;
    }
    if (o.audioBed) {
      const gain = 10 ** ((o.audioBed.gainDb ?? -20) / 20);
      const bed = await decode(
        [
          "-stream_loop",
          "-1",
          "-i",
          o.audioBed.path,
          "-map",
          "0:a:0",
          "-t",
          num(totalSamples / SR),
        ],
        totalSamples,
      );
      for (let i = 0; i < mix.length; i++) mix[i] = (mix[i] ?? 0) + (bed[i] ?? 0) * gain;
    }
    const mixRaw = join(work, "mix.f32");
    writeFileSync(mixRaw, new Uint8Array(mix.buffer));
    const rawIn = ["-f", "f32le", "-ar", String(SR), "-ac", String(CH)];

    // 2. loudness of the final mix, then one command: video concat, ladder, loudnorm, HLS
    const m = await measureLoudness(mixRaw, rawIn);
    const vparts = cuts.map(
      (c, i) =>
        `[${i}:v]trim=start=${num(c.inSec)}:end=${num(c.outSec)},setpts=PTS-STARTPTS,fps=${TARGET.fps},setsar=1[v${i}]`,
    );
    const concatV = `${cuts.map((_, i) => `[v${i}]`).join("")}concat=n=${cuts.length}:v=1:a=0[vcat]`;
    const n = ladder.length;
    const split = `[vcat]split=${n}${ladder.map((_, i) => `[s${i}]`).join("")}`;
    const scales = ladder.map(
      (r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=lanczos,format=yuv420p[v${i}o]`,
    );
    const wi = cuts.length;
    const aNorm =
      `[${wi}:a]loudnorm=I=${TARGET.lufs}:TP=${TARGET.truePeak}:LRA=11:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true,` +
      `aresample=${TARGET.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${n}${ladder.map((_, i) => `[a${i}o]`).join("")}`;
    const fc = [...vparts, concatV, split, ...scales, aNorm].join(";");

    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...cuts.flatMap((c) => ["-i", c.path]),
      ...rawIn,
      "-i",
      mixRaw,
      "-filter_complex",
      fc,
    ];
    ladder.forEach((r, i) => {
      args.push("-map", `[v${i}o]`, "-map", `[a${i}o]`);
      args.push(
        `-c:v:${i}`,
        "libx264",
        `-profile:v:${i}`,
        "high",
        `-b:v:${i}`,
        `${r.videoKbps}k`,
        `-maxrate:v:${i}`,
        `${Math.round(r.videoKbps * 1.2)}k`,
        `-bufsize:v:${i}`,
        `${r.videoKbps * 2}k`,
      );
      args.push(`-c:a:${i}`, "aac", `-b:a:${i}`, `${r.audioKbps}k`);
    });
    const gop = TARGET.fps * seg;
    args.push(
      "-preset",
      "medium",
      "-g",
      String(gop),
      "-keyint_min",
      String(gop),
      "-sc_threshold",
      "0",
      "-force_key_frames",
      `expr:gte(t,n_forced*${seg})`,
      "-r",
      String(TARGET.fps),
      "-fps_mode",
      "cfr",
      "-t",
      num(total),
      ...DETERMINISTIC,
      "-filter_threads",
      "1",
      "-filter_complex_threads",
      "1",
    );
    if (o.encryption) {
      const keyFile = join(work, "enc.key");
      writeFileSync(keyFile, o.encryption.key);
      const info = join(work, "keyinfo");
      writeFileSync(info, `${o.encryption.keyUri}\n${keyFile}\n${hex(o.encryption.iv)}\n`);
      args.push("-hls_key_info_file", info);
    }
    for (let i = 0; i < n; i++) mkdirSync(join(o.outDir, `v${i}`), { recursive: true });
    // ffmpeg's HLS muxer cannot encrypt fMP4 ("Encrypted fmp4 not yet supported"), so encrypted
    // episodes use MPEG-TS segments (hls.js transmuxes them); clear episodes use CMAF fMP4.
    const ts = !!o.encryption;
    args.push(
      "-f",
      "hls",
      "-hls_time",
      String(seg),
      "-hls_playlist_type",
      "vod",
      ...(ts
        ? ["-hls_segment_type", "mpegts"]
        : ["-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4"]),
      "-hls_flags",
      "independent_segments",
      "-master_pl_name",
      "master.m3u8",
      "-var_stream_map",
      ladder.map((_, i) => `v:${i},a:${i}`).join(" "),
      "-hls_segment_filename",
      join(o.outDir, "v%v", ts ? "seg_%05d.ts" : "seg_%05d.m4s"),
      join(o.outDir, "v%v", "index.m3u8"),
    );
    await run("ffmpeg", args);

    const files: RenderedFile[] = [];
    for (const f of walk(o.outDir).sort()) {
      files.push({
        path: relative(o.outDir, f),
        sha256: await hashFile(f),
        bytes: statSync(f).size,
      });
    }
    const h = new Bun.CryptoHasher("sha256");
    for (const f of files) h.update(`${f.path} ${f.sha256}\n`);
    return { master: "master.m3u8", durationSec: total, files, renditionHash: h.digest("hex") };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
