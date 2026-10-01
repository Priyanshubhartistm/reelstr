import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DETERMINISTIC, run } from "@reelstr/media";
import { sha256Hex } from "@reelstr/protocol";

export interface GenRequest {
  prompt: string;
  seed: string;
  refs: string[];
  loras: string[];
  durationSec: number;
}

/** A video generation backend. `open` must be true for a scene to be re-renderable by others. */
export interface GenAdapter {
  readonly model: string;
  readonly open: boolean;
  /** shown to requesters; includes any licence limits of the weights */
  readonly notes: string;
  generate(req: GenRequest): Promise<Uint8Array>;
}

const num = (n: number, dp = 4) => Number(n.toFixed(dp));

/** Deterministic integer in [0, n) from text: parameters for the mock model. */
const pick = (text: string, salt: string, n: number) =>
  Number.parseInt(sha256Hex(new TextEncoder().encode(`${salt}|${text}`)).slice(0, 8), 16) % n;

/**
 * A stand-in "open-weight model" for tests and demos. Its output is a pure function of
 * (prompt, seed, refs, loras, duration) produced by ffmpeg `geq`, so a re-render is byte-identical
 * on the same ffmpeg build. It is NOT a video model: it draws moving colour fields, nothing more.
 */
export class MockAdapter implements GenAdapter {
  readonly open = true;
  readonly notes = "mock model: deterministic colour fields, for tests and demos";
  constructor(readonly model = "mock-open-1") {}

  async generate(req: GenRequest): Promise<Uint8Array> {
    const key = [
      req.prompt,
      req.seed,
      req.refs.join(","),
      req.loras.join(","),
      String(req.durationSec),
    ].join("\u0000");
    const a = 6 + pick(key, "a", 20);
    const b = num(1 + pick(key, "b", 30) / 10);
    const c = 8 + pick(key, "c", 25);
    const f = 200 + pick(key, "f", 600);
    const dir = mkdtempSync(join(tmpdir(), "reelstr-mock-"));
    try {
      const out = join(dir, "gen.mp4");
      await run("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=360x640:r=24:d=${req.durationSec},geq=lum='128+100*sin(X/${a}+T*${b})':cb='128+60*sin(Y/${c}+T)':cr='128+60*cos(X/${a})'`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${f}:duration=${req.durationSec}:sample_rate=44100`,
        "-af",
        "volume=-20dB",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        ...DETERMINISTIC,
        out,
      ]);
      return new Uint8Array(readFileSync(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Wan 2.2 through fal.ai's queue API (auth `Key <key>`, queue.fal.run, status/result URLs from the
 * submit response: checked against the @fal-ai/client source). Tested against a mock queue; never
 * run against the live service (it needs a paid key), so do one real call before relying on it. Wan 2.2 weights are
 * Apache-2.0, so scenes from this adapter are legitimately "open". fal clips are ~5 s at 16 fps, so
 * `durationSec` above ~5 needs several calls stitched; this adapter refuses rather than guess.
 */
export class FalWanAdapter implements GenAdapter {
  readonly model = "wan-2.2-t2v";
  readonly open = true;
  readonly notes =
    "Wan 2.2 (Apache-2.0) via fal.ai; hosted inference, not bit-reproducible across providers";
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "fal-ai/wan/v2.2-a14b/text-to-video",
    private readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (i, o) =>
      fetch(i, o),
    private readonly pollMs = 2000,
  ) {}

  async generate(req: GenRequest): Promise<Uint8Array> {
    if (req.durationSec > 5.5)
      throw new Error("fal Wan 2.2 makes ~5 s clips: request a shorter duration or add stitching");
    const headers = { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" };
    const submit = await this.fetchFn(`https://queue.fal.run/${this.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: req.prompt,
        seed: Number(req.seed) || undefined,
        aspect_ratio: "9:16",
      }),
    });
    if (!submit.ok) throw new Error(`fal submit failed: ${submit.status} ${await submit.text()}`);
    const q = (await submit.json()) as { status_url: string; response_url: string };
    for (let i = 0; i < 180; i++) {
      const st = (await (await this.fetchFn(q.status_url, { headers })).json()) as {
        status: string;
      };
      if (st.status === "COMPLETED") break;
      if (st.status === "FAILED") throw new Error("fal job failed");
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    const out = (await (await this.fetchFn(q.response_url, { headers })).json()) as {
      video?: { url: string };
    };
    if (!out.video?.url) throw new Error("fal returned no video");
    return new Uint8Array(await (await this.fetchFn(out.video.url)).arrayBuffer());
  }
}

export type AdapterRegistry = Map<string, GenAdapter>;
export const registry = (...a: GenAdapter[]): AdapterRegistry =>
  new Map(a.map((x) => [x.model, x]));
