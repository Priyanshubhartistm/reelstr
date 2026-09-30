import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchVerified } from "@reelstr/blossom";
import { normalizeScene, run } from "@reelstr/media";
import {
  buildVerification,
  type EventLike,
  manifestEligibleForVerification,
  parseScene,
  sha256Hex,
  tagsOf,
  type Verdict,
} from "@reelstr/protocol";
import type { AdapterRegistry } from "./adapters";

export interface VerifyResult {
  verdict: Verdict;
  similarity?: number;
  exact?: boolean;
  engine: string;
  reason: string;
}

/** Structural similarity (SSIM, 0..1) of two clips after scaling both to a small common size. */
export async function ssim(a: string, b: string): Promise<number> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    "[0:v]scale=270:480,setsar=1[x];[1:v]scale=270:480,setsar=1[y];[x][y]ssim",
    "-f",
    "null",
    "-",
  ]);
  const m = stderr.match(/All:([0-9.]+)/);
  if (!m) throw new Error("could not read SSIM from ffmpeg");
  return Number(m[1]);
}

/**
 * Re-render a scene from its manifest and compare with the published clip. This shows the
 * manifest regenerates the same video with this engine, here. It does NOT prove who made the
 * clip or that the weights are what they claim. Cross-GPU bitwise equality is not expected:
 * `similarity >= threshold` is the practical bar, `exact` is reported when bytes match.
 */
export async function verifyScene(
  scene: EventLike,
  o: { adapters: AdapterRegistry; threshold?: number },
): Promise<VerifyResult> {
  const threshold = o.threshold ?? 0.95;
  const gen = tagsOf(scene.tags, "gen");
  const modelName = gen.find((g) => g[1] === "model")?.[2] ?? "";
  const engine = modelName;
  if (!manifestEligibleForVerification(scene))
    return {
      verdict: "ineligible",
      engine,
      reason: "manifest needs an open-weight model, a seed, and hashed references",
    };
  const adapter = o.adapters.get(modelName);
  if (!adapter?.open)
    return { verdict: "ineligible", engine, reason: `no open-weight engine for ${modelName} here` };
  const s = parseScene(scene);
  const imeta = tagsOf(scene.tags, "imeta").find(
    (t) => t.some((p) => p.startsWith("m video/")) && !t.includes("variant original"),
  );
  const fallbacks = (imeta?.find((p) => p.startsWith("fallback "))?.slice(9) ?? "")
    .split(" ")
    .filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), "reelstr-verify-"));
  try {
    const original = await fetchVerified([s.videoUrl, ...fallbacks].filter(Boolean), s.videoSha);
    const origPath = join(dir, "original.mp4");
    writeFileSync(origPath, original.bytes);
    const raw = await adapter.generate({
      prompt: s.content,
      seed: s.gen.seed ?? "",
      refs: s.gen.refs,
      loras: s.gen.loras,
      durationSec: Math.round(s.duration * 1000) / 1000,
    });
    const rawPath = join(dir, "raw.mp4");
    writeFileSync(rawPath, raw);
    const rePath = join(dir, "re.mp4");
    await normalizeScene(rawPath, rePath);
    const exact = sha256Hex(new Uint8Array(readFileSync(rePath))) === s.videoSha;
    const sim = exact ? 1 : await ssim(origPath, rePath);
    const ok = exact || sim >= threshold;
    return {
      verdict: ok ? "verified" : "mismatch",
      similarity: sim,
      exact,
      engine,
      reason: ok
        ? exact
          ? "byte-identical re-render"
          : `similarity ${sim.toFixed(4)} >= ${threshold}`
        : `similarity ${sim.toFixed(4)} < ${threshold}`,
    };
  } catch (e) {
    return { verdict: "error", engine, reason: (e as Error).message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Template for the NIP-32 label the verifier signs and publishes. */
export const verificationTemplate = (scene: { id: string; videoSha: string }, r: VerifyResult) =>
  buildVerification({
    sceneId: scene.id,
    sceneSha256: scene.videoSha,
    verdict: r.verdict,
    similarity: r.similarity,
    exact: r.exact,
    engine: r.engine,
  });
