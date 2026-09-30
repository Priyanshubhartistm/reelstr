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
  mediaToken?: string;
  indexerUrl?: string;
  /** NIP-13 bits to mine into scenes (public relays may require it) */
  powBits?: number;
  minRelayAcks?: number;
}

export interface IngestOut {
  original: BlobDescriptor;
  normalized: BlobDescriptor;
  probe: { durationSec: number };
}

/** Everything a Studio or Cinema screen does, with no UI in it. */
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

  async me() {
    return this.cfg.signer.getPublicKey();
  }

  async createStory(p: Omit<StoryParams, "createdAt">) {
    return this.publish(buildStory(p));
  }

  private async mediaJob<T>(path: string, body: unknown): Promise<T> {
    const { mediaUrl, mediaToken } = this.cfg;
    if (!mediaUrl) throw new Error("no media service configured");
    const h = { Authorization: `Bearer ${mediaToken}`, "Content-Type": "application/json" };
    const r = await fetch(`${mediaUrl}${path}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`media service ${path}: ${r.status} ${await r.text()}`);
    const { id } = (await r.json()) as { id: string };
    for (let i = 0; i < 1200; i++) {
      const j = (await (await fetch(`${mediaUrl}/jobs/${id}`, { headers: h })).json()) as {
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
  async publishScene(o: {
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
  }) {
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
      },
      original: { url: r.original.url, sha256: r.original.sha256 },
      story: o.story,
      parent: o.parent,
      license: o.license,
      gen: o.gen,
      commissioner: o.commissioner,
    });
    if (this.cfg.powBits) tpl = withPow(tpl, this.cfg.powBits, pk);
    return { event: await this.publish(tpl), ingest: r };
  }

  /** Fork or continue: same story, parent set, manifest and license carried over. Refuses unforkable licenses. */
  async forkScene(
    parent: NostrEvent,
    o: Omit<
      Parameters<ReelstrClient["publishScene"]>[0],
      "story" | "parent" | "gen" | "license"
    > & { gen?: SceneParams["gen"] },
  ) {
    const s = parseScene(parent);
    if (!isForkable(s.license)) throw new Error(`license ${s.license} does not allow forking`);
    const root = s.storyCoord.split(":");
    return this.publishScene({
      ...o,
      story: { pubkey: root[1] as string, d: root.slice(2).join(":") },
      parent: { id: parent.id },
      license: s.license,
      gen: o.gen ?? { model: s.gen.model, refs: s.gen.refs, loras: s.gen.loras },
    });
  }

  /** Split a curator would publish, for the preview (FE-6). */
  previewSplit(p: CutParams): Weight[] {
    return cutWeights(p);
  }

  /**
   * Publish a Cut: render the HLS episode (media service), pin it in the Cut's imeta, publish.
   * `encryption` is handed to the renderer; the key never enters the event.
   */
  async publishCut(
    o: Omit<CutParams, "curator" | "hls"> & {
      scenesSources: { sha256: string; urls: string[] }[];
      render?: boolean;
      encryption?: { key: string; iv: string; keyUri: string };
    },
  ) {
    const curator = await this.me();
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
        ...(o.encryption ?? {}),
      });
      hls = { url: `${r.masterUrl}.m3u8`, duration: r.durationSec, sha256: r.masterSha256 };
    }
    const { scenesSources: _s, render: _r, encryption: _e, ...rest } = o;
    return this.publish(buildCut({ ...rest, curator, hls }));
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

export type { CutScene };
export { coordinate, cutD, KIND };
