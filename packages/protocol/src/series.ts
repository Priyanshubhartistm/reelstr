import { coordinate, parseCoordinate } from "./coords";
import { cutD } from "./cut";
import { KIND, REELSTR_TAG } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { tagsOf, tagValue } from "./tags";

export interface SeriesParams {
  curator: string;
  slug: string;
  title: string;
  summary: string;
  image?: string;
  /** episode numbers in order */
  episodes: number[];
  freeEpisodes?: number;
  relays?: string[];
  createdAt?: number;
}

export function buildSeries(p: SeriesParams): EventTemplate {
  const tags: string[][] = [
    ["d", p.slug],
    ["title", p.title],
  ];
  if (p.image) tags.push(["image", p.image]);
  for (const n of p.episodes) tags.push(["a", coordinate(KIND.CUT, p.curator, cutD(p.slug, n))]);
  tags.push(["free", String(p.freeEpisodes ?? 0)]);
  for (const r of p.relays ?? []) tags.push(["r", r]);
  tags.push(["t", REELSTR_TAG]);
  return {
    kind: KIND.SERIES,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: p.summary,
  };
}

export function validateSeries(e: EventLike): Validation {
  const c = new Collector();
  if (e.kind !== KIND.SERIES) c.err(`kind must be ${KIND.SERIES}`);
  const slug = tagValue(e.tags, "d") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) c.err("d must be a lowercase slug");
  if (!tagValue(e.tags, "title")) c.err("missing title");
  const free = tagValue(e.tags, "free");
  if (free === undefined || !/^\d+$/.test(free)) c.err("free must be an integer");
  const eps = tagsOf(e.tags, "a");
  if (eps.length === 0) c.warn("series lists no episodes yet");
  const seen = new Set<string>();
  for (const t of eps) {
    const co = parseCoordinate(t[1] ?? "");
    if (!co || co.kind !== KIND.CUT) c.err(`a tag ${t[1]} is not a Cut coordinate`);
    else {
      if (co.pubkey !== e.pubkey) c.warn(`episode ${co.d} is by another curator`);
      if (!co.d.startsWith(`${slug}:`)) c.err(`episode ${co.d} does not belong to series ${slug}`);
    }
    if (seen.has(t[1] ?? "")) c.err(`duplicate episode ${t[1]}`);
    seen.add(t[1] ?? "");
  }
  if (free && Number(free) > eps.length) c.warn("free count exceeds number of episodes");
  return c.result();
}
