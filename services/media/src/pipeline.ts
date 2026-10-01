import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BlobDescriptor, type BlossomClient, fetchVerified } from "@reelstr/blossom";
import {
  captionScenes,
  type NormalizeOptions,
  normalizeScene,
  type Probe,
  type Rung,
  renderEpisode,
  toVtt,
} from "@reelstr/media";
import { sha256Hex } from "@reelstr/protocol";

const work = () => mkdtempSync(join(tmpdir(), "reelstr-job-"));

export interface Hosts {
  primary: BlossomClient;
  mirrors: BlossomClient[];
}

/** Upload to the primary, then mirror onto every other server. Mirror failures are returned, not thrown. */
async function put(h: Hosts, bytes: Uint8Array, type: string) {
  const primary = await h.primary.upload(bytes, type);
  const failed: { server: string; reason: string }[] = [];
  for (const m of h.mirrors) {
    try {
      await m.mirror(primary.url, primary.sha256);
    } catch (e) {
      failed.push({ server: m.server, reason: (e as Error).message });
    }
  }
  return { primary, failed };
}

export interface IngestResult {
  original: BlobDescriptor;
  normalized: BlobDescriptor;
  probe: Probe;
  mirrorFailures: { server: string; reason: string }[];
}

/** BE-1: fetch an uploaded clip (hash-verified), normalize it, store both original and normalized. */
export async function ingestScene(
  src: { urls: string[]; sha256: string },
  hosts: Hosts,
  opts: NormalizeOptions = {},
): Promise<IngestResult> {
  const dir = work();
  try {
    const { bytes } = await fetchVerified(src.urls, src.sha256);
    const inPath = join(dir, "in.mp4");
    const outPath = join(dir, "out.mp4");
    writeFileSync(inPath, bytes);
    const probe = await normalizeScene(inPath, outPath, opts);
    const norm = new Uint8Array(readFileSync(outPath));
    const a = await put(hosts, norm, "video/mp4");
    // keep the original too; if it was already uploaded under this hash the server just answers with it
    const o = await put(hosts, bytes, "video/mp4");
    return {
      original: o.primary,
      normalized: a.primary,
      probe,
      mirrorFailures: [...a.failed, ...o.failed],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CT: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  ts: "video/mp2t",
};
const ext = (f: string) => f.slice(f.lastIndexOf(".") + 1);

export interface PublishedHls {
  masterSha256: string;
  masterUrl: string;
  /** every blob that makes up the episode (for mirroring and pinning) */
  blobs: { sha256: string; name: string }[];
  mirrorFailures: { server: string; reason: string }[];
}

/**
 * Upload a rendered HLS tree as content-addressed blobs. Per the Blossom HLS convention every
 * playlist/segment is its own blob and references its children by `<sha256>.<ext>`, so children
 * are uploaded first and the playlists rewritten bottom-up before their own hashes are known.
 */
export async function publishHls(dir: string, hosts: Hosts): Promise<PublishedHls> {
  const blobs: PublishedHls["blobs"] = [];
  const failures: PublishedHls["mirrorFailures"] = [];
  const upload = async (name: string, bytes: Uint8Array) => {
    const r = await put(hosts, bytes, CT[ext(name)] ?? "application/octet-stream");
    failures.push(...r.failed);
    blobs.push({ sha256: r.primary.sha256, name });
    return r.primary;
  };
  const variants = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const variantRef = new Map<string, string>();
  for (const v of variants) {
    const names = new Map<string, string>();
    for (const f of readdirSync(join(dir, v)).sort()) {
      if (f.endsWith(".m3u8")) continue;
      const d = await upload(`${v}/${f}`, new Uint8Array(readFileSync(join(dir, v, f))));
      names.set(f, `${d.sha256}.${ext(f)}`);
    }
    let pl = readFileSync(join(dir, v, "index.m3u8"), "utf8");
    for (const [from, to] of names)
      pl = pl.split(`"${from}"`).join(`"${to}"`).split(`\n${from}\n`).join(`\n${to}\n`);
    const d = await upload(`${v}/index.m3u8`, new TextEncoder().encode(pl));
    variantRef.set(`${v}/index.m3u8`, `${d.sha256}.m3u8`);
  }
  let master = readFileSync(join(dir, "master.m3u8"), "utf8");
  for (const [from, to] of variantRef) master = master.split(from).join(to);
  const m = await upload("master.m3u8", new TextEncoder().encode(master));
  return { masterSha256: m.sha256, masterUrl: `${m.url}`, blobs, mirrorFailures: failures };
}

export interface RenderJob {
  scenes: { sha256: string; urls: string[]; inSec: number; outSec: number }[];
  audioBed?: { sha256: string; urls: string[]; gainDb?: number };
  encryption?: { key: Uint8Array; iv: Uint8Array; keyUri: string };
  ladder?: Rung[];
}

export interface RenderPublished extends PublishedHls {
  durationSec: number;
  renditionHash: string;
}

/** BE-2: fetch verified scene blobs, render the episode, publish it to Blossom. */
export async function renderAndPublish(job: RenderJob, hosts: Hosts): Promise<RenderPublished> {
  const dir = work();
  try {
    const cache = new Map<string, string>();
    const local = async (sha256: string, urls: string[]) => {
      let p = cache.get(sha256);
      if (!p) {
        const { bytes } = await fetchVerified(urls, sha256);
        p = join(dir, `${sha256}.bin`);
        writeFileSync(p, bytes);
        cache.set(sha256, p);
      }
      return p;
    };
    const scenes = [];
    for (const s of job.scenes)
      scenes.push({ path: await local(s.sha256, s.urls), inSec: s.inSec, outSec: s.outSec });
    const bed = job.audioBed && {
      path: await local(job.audioBed.sha256, job.audioBed.urls),
      gainDb: job.audioBed.gainDb,
    };
    const out = join(dir, "hls");
    mkdirSync(out, { recursive: true });
    const r = await renderEpisode({
      scenes,
      audioBed: bed,
      outDir: out,
      encryption: job.encryption,
      ladder: job.ladder,
    });
    const pub = await publishHls(out, hosts);
    return { ...pub, durationSec: r.durationSec, renditionHash: r.renditionHash };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface CaptionJob {
  scenes: { sha256: string; urls: string[]; inSec: number; outSec: number }[];
}
export interface CaptionResult {
  url: string;
  sha256: string;
  language: string;
  cues: number;
  /** the draft text, so the creator can read and fix it before publishing */
  vtt: string;
}

/** Draft captions for an episode: transcribe each trimmed scene locally, upload the WebVTT. */
export async function captionEpisode(job: CaptionJob, hosts: Hosts): Promise<CaptionResult> {
  const dir = work();
  try {
    const scenes = [];
    for (const [i, s] of job.scenes.entries()) {
      const { bytes } = await fetchVerified(s.urls, s.sha256);
      const path = join(dir, `${i}.bin`);
      writeFileSync(path, bytes);
      scenes.push({ path, inSec: s.inSec, outSec: s.outSec });
    }
    const { cues, language } = await captionScenes(scenes);
    if (cues.length === 0) throw new Error("no speech found in this episode");
    const vtt = toVtt(cues);
    const { primary } = await put(hosts, new TextEncoder().encode(vtt), "text/vtt");
    return { url: primary.url, sha256: primary.sha256, language, cues: cues.length, vtt };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * BE-8: when a curator publishes a Cut, copy every blob it references onto the curator's server.
 * Prefers BUD-04 mirror (server-to-server); falls back to verified download + upload.
 */
export async function mirrorBlobs(
  blobs: { sha256: string; urls: string[]; type?: string }[],
  to: BlossomClient,
): Promise<{ ok: string[]; failed: { sha256: string; reason: string }[] }> {
  const ok: string[] = [];
  const failed: { sha256: string; reason: string }[] = [];
  for (const b of blobs) {
    try {
      if (await to.has(b.sha256)) {
        ok.push(b.sha256);
        continue;
      }
      let done = false;
      for (const u of b.urls) {
        try {
          await to.mirror(u, b.sha256);
          done = true;
          break;
        } catch {}
      }
      if (!done) {
        const { bytes } = await fetchVerified(b.urls, b.sha256);
        const d = await to.upload(bytes, b.type ?? "application/octet-stream");
        if (d.sha256 !== sha256Hex(bytes)) throw new Error("hash mismatch after upload");
      }
      ok.push(b.sha256);
    } catch (e) {
      failed.push({ sha256: b.sha256, reason: (e as Error).message });
    }
  }
  return { ok, failed };
}
