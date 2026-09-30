/** Web-of-trust helpers (BE-5). Pure functions over a follow graph. */

export type FollowGraph = Map<string, Set<string>>;

/** hops from any root to `target` over follows; undefined if not reachable within maxHops. */
export function distances(graph: FollowGraph, roots: string[], maxHops = 3): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = roots;
  for (const r of roots) dist.set(r, 0);
  for (let hop = 1; hop <= maxHops; hop++) {
    const next: string[] = [];
    for (const p of frontier)
      for (const f of graph.get(p) ?? []) {
        if (dist.has(f)) continue;
        dist.set(f, hop);
        next.push(f);
      }
    frontier = next;
  }
  return dist;
}

/** NIP-13 difficulty: leading zero bits of the event id. */
export function powBits(id: string): number {
  let bits = 0;
  for (const ch of id) {
    const n = Number.parseInt(ch, 16);
    if (n === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(n) - 28;
    break;
  }
  return bits;
}

export interface InboxItem {
  id: string;
  author: string;
  created_at: number;
  pow_bits: number;
}

export interface RankOpts {
  graph: FollowGraph;
  roots: string[];
  /** msats zapped to each author */
  zaps: Map<string, number>;
  /** unknown authors need at least this much PoW to appear at all */
  minPowBits?: number;
  maxHops?: number;
}

const HOP_SCORE = [1000, 100, 50, 20];

/**
 * Rank inbox items: closer in the follow graph first, zaps break ties within a hop, PoW lifts
 * unknown authors. Unknown authors without enough PoW are hidden, not just ranked low.
 */
export function rankInbox(
  items: InboxItem[],
  o: RankOpts,
): (InboxItem & { score: number; hops?: number })[] {
  const dist = distances(o.graph, o.roots, o.maxHops ?? 3);
  const minPow = o.minPowBits ?? 16;
  const out: (InboxItem & { score: number; hops?: number })[] = [];
  for (const it of items) {
    const hops = dist.get(it.author);
    if (hops === undefined && it.pow_bits < minPow) continue;
    const base = hops === undefined ? 0 : (HOP_SCORE[hops] ?? 0);
    const zap = Math.log2(1 + (o.zaps.get(it.author) ?? 0) / 1000);
    out.push({ ...it, hops, score: base + zap + (hops === undefined ? it.pow_bits / 4 : 0) });
  }
  return out.sort(
    (a, b) => b.score - a.score || b.created_at - a.created_at || a.id.localeCompare(b.id),
  );
}
