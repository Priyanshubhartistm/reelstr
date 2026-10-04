import { type BlobDescriptor, BlossomClient } from "@reelstr/blossom";
import { type NostrEvent, RelayPool, type Signer, withPow } from "@reelstr/nostr";
import {
  buildCut,
  buildScene,
  buildSeries,
  buildStory,
  type CutParams,
  type CutScene,
  coordinate,
  cutD,
  cutWeights,
  httpAuthHeader,
  httpAuthTemplate,
  isForkable,
  KIND,
  parseScene,
  type SceneParams,
  type SeriesParams,
  type StoryParams,
  validateEvent,
  type Weight,
} from "@reelstr/protocol";

export interface Config {
  signer: Signer;
  relays: string[];
  blossom: string;
  /** extra Blossom servers that receive mirrors of everything published */
  mirrors?: string[];
  mediaUrl?: string;
  indexerUrl?: string;
  /** HLS key server: paid episodes are encrypted and their keys registered here */
  keysUrl?: string;
  /** NIP-13 bits to mine into scenes (public relays may require it) */
  powBits?: number;
  minRelayAcks?: number;
}

const randomHex = (bytes: number) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

export interface SceneInput {
  bytes: Uint8Array;
  contentType?: string;
  title: string;
  prompt: string;
  story: { pubkey: string; d: string };
  parent?: { id: string };
  license?: string;
  gen?: SceneParams["gen"];
  commissioner?: { pubkey: string };
  fit?: "crop" | "letterbox";
}

export interface IngestOut {
  original: BlobDescriptor;
  normalized: BlobDescriptor;
  thumbnail?: BlobDescriptor;
  probe: { durationSec: number };
}

/** Everything a screen does, with no UI in it. */
export class ReelstrClient {
  readonly pool = new RelayPool();
  readonly blossom: BlossomClient;
  constructor(readonly cfg: Config) {
    this.blossom = new BlossomClient(cfg.blossom, cfg.signer);
  }

  private async publish(tpl: Parameters<Signer["signEvent"]>[0]): Promise<NostrEvent> {
    const ev = await this.cfg.signer.signEvent(tpl);
    const v = validateEvent(ev, { verifySig: true });
    if (!v.ok) throw new Error(`refusing to publish an invalid event: ${v.errors.join("; ")}`);
    await this.pool.publish(
      ev,
      this.cfg.relays,
      Math.min(this.cfg.minRelayAcks ?? 1, this.cfg.relays.length),
    );
    return ev;
  }

  private powCache: Promise<number> | null = null;

  /**
   * PoW to mine into a scene: the highest NIP-11 `limitation.min_pow_difficulty` among our relays
   * (so a PoW-gated relay works without configuration), never less than an explicit `powBits`.
   * A relay that cannot be reached for its info document just contributes 0.
   */
  requiredPow(): Promise<number> {
    this.powCache ??= (async () => {
      const asked = await Promise.all(
        this.cfg.relays.map(async (r) => {
          try {
            const res = await fetch(r.replace(/^ws/, "http"), {
              headers: { Accept: "application/nostr+json" },
            });
            const j = (await res.json()) as { limitation?: { min_pow_difficulty?: number } };
            return Number(j.limitation?.min_pow_difficulty ?? 0) || 0;
          } catch {
            return 0;
          }
        }),
      );
      return Math.max(this.cfg.powBits ?? 0, ...asked);
    })();
    return this.powCache;
  }

  async me() {
    return this.cfg.signer.getPublicKey();
  }

  async createStory(p: Omit<StoryParams, "createdAt">) {
    return this.publish(buildStory(p));
  }

  /** Sign one request to a service that uses NIP-98 (URL, method and body are bound into the signature). */
  private async signed(
    url: string,
    method: string,
    body?: string,
  ): Promise<Record<string, string>> {
    const ev = await this.cfg.signer.signEvent(httpAuthTemplate({ url, method, body }));
    return {
      Authorization: httpAuthHeader(ev),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    };
  }

  private async mediaJob<T>(path: string, body: unknown): Promise<T> {
    const { mediaUrl } = this.cfg;
    if (!mediaUrl) throw new Error("no media service configured");
    const text = JSON.stringify(body);
    const r = await fetch(`${mediaUrl}${path}`, {
      method: "POST",
      headers: await this.signed(`${mediaUrl}${path}`, "POST", text),
      body: text,
    });
    if (!r.ok) throw new Error(`media service ${path}: ${r.status} ${await r.text()}`);
    const { id } = (await r.json()) as { id: string };
    for (let i = 0; i < 1200; i++) {
      const j = (await (
        await fetch(`${mediaUrl}/jobs/${id}`, {
          headers: await this.signed(`${mediaUrl}/jobs/${id}`, "GET"),
        })
      ).json()) as {
        status: string;
        result?: T;
        error?: string;
      };
      if (j.status === "done") return j.result as T;
      if (j.status === "failed") throw new Error(`media job failed: ${j.error}`);
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("media job timed out");
  }

  /**
   * Upload a clip and publish it as a Scene: store the original, have the media service
   * normalize it, pin the normalized blob, sign and publish.
   */
  async publishScene(o: SceneInput) {
    const { template, ingest } = await this.prepareScene(o);
    return { event: await this.publish(template), ingest };
  }

  /**
   * Upload and normalize a clip and build the Scene template, without publishing it. Used for
   * crew-room drafts: the blobs go to Blossom, the event goes only where the caller sends it.
   */
  async prepareScene(o: SceneInput) {
    const orig = await this.blossom.upload(o.bytes, o.contentType ?? "video/mp4");
    const r = await this.mediaJob<IngestOut>("/ingest", {
      sha256: orig.sha256,
      urls: [orig.url],
      fit: o.fit,
    });
    const pk = await this.me();
    let tpl = buildScene({
      title: o.title,
      content: o.prompt,
      video: {
        url: r.normalized.url,
        sha256: r.normalized.sha256,
        duration: Math.round(r.probe.durationSec * 1000) / 1000,
        fallback: (this.cfg.mirrors ?? []).map((m) => `${m}/${r.normalized.sha256}`),
        thumbnail: r.thumbnail?.url,
      },
      original: { url: r.original.url, sha256: r.original.sha256 },
      story: o.story,
      parent: o.parent,
      license: o.license,
      gen: o.gen,
      commissioner: o.commissioner,
    });
    const bits = await this.requiredPow();
    if (bits) tpl = await withPow(tpl, bits, pk);
    return { template: tpl, ingest: r };
  }

  /** Scene input for a fork: same story, parent set, manifest and license carried over. Refuses unforkable licenses. */
  forkInput(
    parent: NostrEvent,
    o: Omit<SceneInput, "story" | "parent" | "gen" | "license"> & { gen?: SceneParams["gen"] },
  ): SceneInput {
    const s = parseScene(parent);
    if (!isForkable(s.license)) throw new Error(`license ${s.license} does not allow forking`);
    const root = s.storyCoord.split(":");
    return {
      ...o,
      story: { pubkey: root[1] as string, d: root.slice(2).join(":") },
      parent: { id: parent.id },
      license: s.license,
      gen: o.gen ?? { model: s.gen.model, refs: s.gen.refs, loras: s.gen.loras },
    };
  }

  /** Fork or continue and publish. */
  async forkScene(parent: NostrEvent, o: Parameters<ReelstrClient["forkInput"]>[1]) {
    return this.publishScene(this.forkInput(parent, o));
  }

  /** Split a curator would publish, for the preview (FE-6). */
  previewSplit(p: CutParams): Weight[] {
    return cutWeights(p);
  }

  /**
   * Publish a Cut: render the HLS episode (media service), pin it in the Cut's imeta, publish.
   * A paid episode (price > 0, not `free`) is rendered AES-128 encrypted with a fresh random key.
   * The key never enters an event: after the Cut is signed it is registered with the key server,
   * pinned to this exact Cut version. Leak-tolerant by design: any paying viewer holds the key.
   */
  async publishCut(
    o: Omit<CutParams, "curator" | "hls"> & {
      scenesSources: { sha256: string; urls: string[] }[];
      render?: boolean;
      /** this episode is in the series' free window: no key gate */
      free?: boolean;
    },
  ) {
    const curator = await this.me();
    const keysUrl = this.cfg.keysUrl;
    const paid = o.price.amount > 0 && !o.free && !!keysUrl;
    const d = cutD(o.seriesSlug, o.episode);
    const enc = paid
      ? {
          key: randomHex(16),
          iv: randomHex(16),
          keyUri: `${keysUrl}/key/${curator}/${encodeURIComponent(d)}`,
        }
      : undefined;
    let hls: CutParams["hls"];
    if (o.render !== false && this.cfg.mediaUrl) {
      const r = await this.mediaJob<{
        masterUrl: string;
        masterSha256: string;
        durationSec: number;
      }>("/render", {
        scenes: o.scenes.map((s, i) => ({
          ...(o.scenesSources[i] as { sha256: string; urls: string[] }),
          inSec: s.inSec,
          outSec: s.outSec,
        })),
        ...(enc ?? {}),
      });
      hls = { url: `${r.masterUrl}.m3u8`, duration: r.durationSec, sha256: r.masterSha256 };
    }
    const { scenesSources: _s, render: _r, free: _f, ...rest } = o;
    const cut = await this.publish(buildCut({ ...rest, curator, hls }));
    if (enc && keysUrl) await this.registerEpisodeKey(keysUrl, d, enc, o.price.amount, cut.id);
    return cut;
  }

  /** Draft WebVTT captions for an episode (local speech-to-text on the media service). */
  async generateCaptions(
    scenes: { sha256: string; urls: string[]; inSec: number; outSec: number }[],
  ) {
    return this.mediaJob<{
      url: string;
      sha256: string;
      language: string;
      cues: number;
      vtt: string;
    }>("/captions", { scenes });
  }

  /** Hand the episode key to the key server, authenticated as the curator (NIP-98). */
  async registerEpisodeKey(
    keysUrl: string,
    d: string,
    enc: { key: string; iv: string },
    priceSats: number,
    cutEventId: string,
  ) {
    const url = `${keysUrl}/episodes`;
    const text = JSON.stringify({
      d,
      keyHex: enc.key,
      ivHex: enc.iv,
      priceSats,
      free: false,
      cutEventId,
    });
    const r = await fetch(url, {
      method: "POST",
      headers: await this.signed(url, "POST", text),
      body: text,
    });
    if (!r.ok) throw new Error(`key server refused the episode key: ${r.status} ${await r.text()}`);
  }

  async publishSeries(o: Omit<SeriesParams, "curator">) {
    return this.publish(buildSeries({ ...o, curator: await this.me() }));
  }

  /** Indexer reads (FE-4, FE-10, US-C5). */
  async api<T>(path: string): Promise<T> {
    if (!this.cfg.indexerUrl) throw new Error("no indexer configured");
    const r = await fetch(`${this.cfg.indexerUrl}${path}`);
    if (!r.ok) throw new Error(`indexer ${path}: ${r.status}`);
    return (await r.json()) as T;
  }
}

export * from "./crew";
export type { CutScene };
export { coordinate, cutD, KIND };
