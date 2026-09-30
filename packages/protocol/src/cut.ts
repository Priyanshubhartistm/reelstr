import { coordinate, parseCoordinate } from "./coords";
import { KIND, WEIGHT_TOTAL } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { computeWeights, DEFAULT_AUDIO_BED_BPS, type Weight } from "./split";
import { imetaTag, isHex64, isSeconds, parseImeta, tagsOf, tagValue, toMs } from "./tags";

export const EPISODE_TARGET_SEC: [number, number] = [60, 120];
const ROLES = new Set(["creator", "audio", "curator", "host"]);

export interface CutScene {
  id: string;
  sha256: string;
  inSec: number;
  outSec: number;
  /** who gets paid for this scene (Scene.payee) */
  payee: string;
}

export interface CutParams {
  curator: string;
  seriesSlug: string;
  episode: number;
  title: string;
  synopsis: string;
  scenes: CutScene[];
  audioBed?: { sha256: string; payee: string; poolBps?: number };
  hls?: { url: string; duration: number; sha256?: string };
  price: { amount: number; unit?: "sat" };
  curatorBps: number;
  hostBps: number;
  host: string;
  relay?: string;
  createdAt?: number;
}

export const cutD = (slug: string, episode: number) =>
  `${slug}:ep-${String(episode).padStart(3, "0")}`;

export function cutWeights(p: CutParams): Weight[] {
  return computeWeights({
    scenes: p.scenes.map((s) => ({ payee: s.payee, inSec: s.inSec, outSec: s.outSec })),
    audioBed: p.audioBed && { payee: p.audioBed.payee, poolBps: p.audioBed.poolBps },
    curatorBps: p.curatorBps,
    hostBps: p.hostBps,
    curator: p.curator,
    host: p.host,
  });
}

export function buildCut(p: CutParams): EventTemplate {
  const relay = p.relay ?? "";
  const tags: string[][] = [
    ["d", cutD(p.seriesSlug, p.episode)],
    ["a", coordinate(KIND.SERIES, p.curator, p.seriesSlug), relay],
    ["title", p.title],
    ["episode", String(p.episode)],
  ];
  for (const s of p.scenes)
    tags.push(["scene", s.id, s.sha256, String(s.inSec), String(s.outSec), s.payee]);
  if (p.audioBed) {
    const t = ["audio-bed", p.audioBed.sha256, p.audioBed.payee];
    if (p.audioBed.poolBps !== undefined) t.push(String(p.audioBed.poolBps));
    tags.push(t);
  }
  if (p.hls)
    tags.push(
      imetaTag({
        url: p.hls.url,
        m: "application/x-mpegURL",
        x: p.hls.sha256,
        duration: p.hls.duration,
      }),
    );
  tags.push(["price", String(p.price.amount), p.price.unit ?? "sat"]);
  for (const w of cutWeights(p)) tags.push(["zap", w.pubkey, relay, String(w.weight), w.role]);
  return {
    kind: KIND.CUT,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: p.synopsis,
  };
}

export interface Cut {
  id?: string;
  curator: string;
  d: string;
  seriesSlug: string;
  episode: number;
  title: string;
  synopsis: string;
  scenes: CutScene[];
  audioBed?: { sha256: string; payee: string; poolBps: number };
  hlsUrl?: string;
  price: { amount: number; unit: string };
  weights: Weight[];
  durationSec: number;
}

export function parseCut(e: EventLike): Cut {
  const d = tagValue(e.tags, "d") ?? "";
  const scenes: CutScene[] = tagsOf(e.tags, "scene").map((t) => ({
    id: t[1] ?? "",
    sha256: t[2] ?? "",
    inSec: Number(t[3]),
    outSec: Number(t[4]),
    payee: t[5] ?? "",
  }));
  const bed = tagsOf(e.tags, "audio-bed")[0];
  const price = tagsOf(e.tags, "price")[0];
  const hls = tagsOf(e.tags, "imeta")
    .map(parseImeta)
    .find((m) => m.m === "application/x-mpegURL");
  return {
    id: e.id,
    curator: e.pubkey,
    d,
    seriesSlug: d.split(":")[0] ?? "",
    episode: Number(tagValue(e.tags, "episode")),
    title: tagValue(e.tags, "title") ?? "",
    synopsis: e.content,
    scenes,
    audioBed: bed && {
      sha256: bed[1] ?? "",
      payee: bed[2] ?? "",
      poolBps: bed[3] ? Number(bed[3]) : DEFAULT_AUDIO_BED_BPS,
    },
    hlsUrl: hls?.url,
    price: { amount: Number(price?.[1]), unit: price?.[2] ?? "" },
    weights: tagsOf(e.tags, "zap").map((t) => ({
      pubkey: t[1] ?? "",
      weight: Number(t[3]),
      role: (t[4] ?? "creator") as Weight["role"],
    })),
    durationSec: scenes.reduce((a, s) => a + (toMs(s.outSec) - toMs(s.inSec)) / 1000, 0),
  };
}

export interface CutContext {
  /** scene event id -> blob duration (s); when given, trims are bounds-checked */
  sceneDurations?: Map<string, number>;
  /** downgrade weight mismatch from error to warning (client "warn on mismatch" mode) */
  lenientWeights?: boolean;
}

const key = (w: { pubkey: string; role: string; weight: number }) =>
  `${w.role}:${w.pubkey}:${w.weight}`;

export function validateCut(e: EventLike, ctx: CutContext = {}): Validation {
  const c = new Collector();
  if (e.kind !== KIND.CUT) c.err(`kind must be ${KIND.CUT}`);
  const d = tagValue(e.tags, "d") ?? "";
  const m = /^([a-z0-9][a-z0-9-]*):ep-(\d{3,})$/.exec(d);
  if (!m) c.err("d must look like <series-slug>:ep-NNN");
  const slug = m?.[1] ?? "";
  const epNum = Number(m?.[2]);
  if (m && Number(tagValue(e.tags, "episode")) !== epNum) c.err("episode tag must match d");
  if (!tagValue(e.tags, "title")) c.err("missing title");

  const aSeries = tagsOf(e.tags, "a")[0];
  const co = aSeries && parseCoordinate(aSeries[1] ?? "");
  if (!co || co.kind !== KIND.SERIES) c.err("missing a tag pointing at the Series");
  else {
    if (co.pubkey !== e.pubkey) c.err("Series must be owned by the Cut's curator");
    if (m && co.d !== slug) c.err("Series slug must match d prefix");
  }

  const price = tagsOf(e.tags, "price")[0];
  if (!price || !/^\d+$/.test(price[1] ?? "") || price[2] !== "sat")
    c.err("price must be [price, <int>, sat]");

  const scenes = tagsOf(e.tags, "scene");
  if (scenes.length === 0) c.err("a Cut needs at least one scene");
  let totalMs = 0;
  const seen = new Set<string>();
  for (const [i, t] of scenes.entries()) {
    const at = `scene[${i}]`;
    if (!isHex64(t[1])) c.err(`${at}: event id must be 64 hex`);
    if (!isHex64(t[2])) c.err(`${at}: blob sha256 must be 64 hex`);
    if (!isHex64(t[5])) c.err(`${at}: payee pubkey must be 64 hex`);
    if (!isSeconds(t[3] ?? "") || !isSeconds(t[4] ?? "")) {
      c.err(`${at}: in/out must be seconds with at most 3 decimals`);
      continue;
    }
    const inMs = toMs(t[3] ?? "0");
    const outMs = toMs(t[4] ?? "0");
    if (outMs <= inMs) c.err(`${at}: out must be after in`);
    totalMs += Math.max(0, outMs - inMs);
    const dur = ctx.sceneDurations?.get(t[1] ?? "");
    if (dur !== undefined && outMs > Math.round(dur * 1000))
      c.err(`${at}: out exceeds scene duration ${dur}s`);
    if (seen.has(`${t[1]}:${t[3]}:${t[4]}`)) c.warn(`${at}: duplicate scene range`);
    seen.add(`${t[1]}:${t[3]}:${t[4]}`);
  }
  const total = totalMs / 1000;
  if (total > 0 && (total < EPISODE_TARGET_SEC[0] || total > EPISODE_TARGET_SEC[1]))
    c.warn(`episode is ${total}s, outside the ${EPISODE_TARGET_SEC.join("-")}s target`);

  const bed = tagsOf(e.tags, "audio-bed")[0];
  if (bed) {
    if (!isHex64(bed[1])) c.err("audio-bed sha256 must be 64 hex");
    if (!isHex64(bed[2])) c.err("audio-bed payee must be 64 hex");
    if (bed[3] !== undefined && !/^\d+$/.test(bed[3])) c.err("audio-bed bps must be an integer");
  }

  // Split: structure first, then recompute and compare.
  const zaps = tagsOf(e.tags, "zap");
  let sum = 0;
  let structural = true;
  for (const [i, t] of zaps.entries()) {
    if (!isHex64(t[1])) {
      c.err(`zap[${i}]: pubkey must be 64 hex`);
      structural = false;
    }
    if (!/^\d+$/.test(t[3] ?? "")) {
      c.err(`zap[${i}]: weight must be a non-negative integer`);
      structural = false;
    }
    if (!ROLES.has(t[4] ?? "")) {
      c.err(`zap[${i}]: role must be one of ${[...ROLES].join("|")}`);
      structural = false;
    }
    sum += Number(t[3]);
  }
  if (zaps.length === 0) c.err("a Cut must declare its split with zap tags");
  else if (sum !== WEIGHT_TOTAL) c.err(`zap weights sum to ${sum}, must be ${WEIGHT_TOTAL}`);

  if (
    structural &&
    zaps.length > 0 &&
    scenes.length > 0 &&
    totalMs > 0 &&
    !c.errors.some((x) => x.startsWith("scene["))
  ) {
    const declared = zaps.map((t) => ({
      pubkey: t[1] ?? "",
      role: t[4] ?? "",
      weight: Number(t[3]),
    }));
    const sumOf = (role: string) =>
      declared.filter((w) => w.role === role).reduce((a, w) => a + w.weight, 0);
    const curatorBps = sumOf("curator");
    const hostBps = sumOf("host");
    const cu = declared.find((w) => w.role === "curator")?.pubkey ?? e.pubkey;
    const ho = declared.find((w) => w.role === "host")?.pubkey ?? e.pubkey;
    try {
      const expected = computeWeights({
        scenes: scenes.map((t) => ({
          payee: t[5] ?? "",
          inSec: Number(t[3]),
          outSec: Number(t[4]),
        })),
        audioBed: bed && { payee: bed[2] ?? "", poolBps: bed[3] ? Number(bed[3]) : undefined },
        curatorBps,
        hostBps,
        curator: cu,
        host: ho,
      });
      const a = expected.map(key).sort().join(",");
      const b = declared
        .filter((w) => w.weight > 0)
        .map(key)
        .sort()
        .join(",");
      if (a !== b)
        (ctx.lenientWeights ? c.warn : c.err).call(
          c,
          `declared weights differ from recomputed (${expected.map((w) => `${w.role}:${w.weight}`).join(" ")})`,
        );
    } catch (err) {
      c.err(`cannot recompute weights: ${(err as Error).message}`);
    }
  }
  return c.result();
}
