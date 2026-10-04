import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./run";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ROOT = join(import.meta.dir, "..", "..", "..");
const python = () => process.env.ASR_PYTHON ?? join(ROOT, ".venv-asr", "bin", "python");
const script = join(import.meta.dir, "..", "asr", "transcribe.py");

/** True when the local speech-to-text environment is installed (see infra/python/requirements-asr.txt). */
export const asrAvailable = () => Bun.file(python()).exists();

const ts = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

export const toVtt = (cues: Cue[]) =>
  `WEBVTT\n\n${cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n")}`;

/**
 * Cues for an episode made of trimmed scenes, timed against the episode (each scene's speech is
 * shifted by the seconds before it). Speech is transcribed locally; nothing is sent to a service.
 * It is a draft: the creator should read it before publishing (names and rare words get mangled).
 */
export async function captionScenes(
  scenes: { path: string; inSec: number; outSec: number }[],
  o: { model?: string } = {},
): Promise<{ cues: Cue[]; language: string }> {
  if (!(await asrAvailable()))
    throw new Error(
      "speech-to-text is not installed (uv pip install -r infra/python/requirements-asr.txt)",
    );
  const dir = mkdtempSync(join(tmpdir(), "reelstr-asr-"));
  try {
    const cues: Cue[] = [];
    let offset = 0;
    let language = "en";
    for (const [i, s] of scenes.entries()) {
      const dur = s.outSec - s.inSec;
      const wav = join(dir, `s${i}.wav`);
      // a scene with no audio track has nothing to transcribe
      const has = (
        await run("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          s.path,
        ])
      ).stdout.trim();
      if (has) {
        await run("ffmpeg", [
          "-y",
          "-v",
          "error",
          "-ss",
          String(s.inSec),
          "-t",
          String(dur),
          "-i",
          s.path,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          wav,
        ]);
        const { stdout } = await run(python(), [script, wav, ...(o.model ? [o.model] : [])]);
        const r = JSON.parse(stdout) as { language: string; segments: Cue[] };
        if (r.segments.length) language = r.language;
        for (const seg of r.segments)
          if (seg.text)
            cues.push({
              start: offset + seg.start,
              end: offset + Math.min(seg.end, dur),
              text: seg.text,
            });
      }
      offset += dur;
    }
    return { cues, language };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
