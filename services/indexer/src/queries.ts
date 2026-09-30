import type { Db } from "./db";
import { type FollowGraph, type InboxItem, rankInbox } from "./wot";

export interface TreeNode {
  id: string;
  author: string;
  payee: string;
  parent_id: string | null;
  title: string;
  duration: number;
  depth: number;
  created_at: number;
  used: boolean;
}

/** FE-4: a story's scene tree with a `used` flag for scenes that appear in any published Cut. */
export async function storyTree(db: Db, storyCoord: string): Promise<TreeNode[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with recursive t as (
       select s.*, 0 as depth from scenes s
        where s.story_coord = $1
          and (s.parent_id is null or s.parent_id not in (select id from scenes where story_coord = $1))
       union all
       select c.*, t.depth + 1 from scenes c join t on c.parent_id = t.id
        where c.story_coord = $1 and t.depth < 10000
     )
     select t.id, t.author, t.payee, t.parent_id, t.title, t.duration, t.depth, t.created_at,
            exists (select 1 from cut_scenes cs join cuts c on c.id = cs.cut_id where cs.scene_id = t.id) as used
       from t order by depth, created_at, id`,
    [storyCoord],
  );
  return rows.map((r) => ({
    ...r,
    duration: Number(r.duration),
    depth: Number(r.depth),
    created_at: Number(r.created_at),
  })) as TreeNode[];
}

export interface Credit {
  pubkey: string;
  role: string;
  weight: number;
  seconds: number;
  percent: number;
}

/** FE-10: every recipient of a Cut with seconds used and share; percents total 100. */
export async function credits(db: Db, cutId: string): Promise<Credit[]> {
  const rows = await db.query<{
    pubkey: string;
    role: string;
    weight: number;
    secs: number | null;
  }>(
    `select w.pubkey, w.role, w.weight, s.secs
       from cut_weights w
       left join (select payee, sum(out_sec - in_sec) as secs from cut_scenes where cut_id = $1 group by payee) s
         on s.payee = w.pubkey and w.role = 'creator'
      where w.cut_id = $1 order by w.weight desc, w.pubkey, w.role`,
    [cutId],
  );
  return rows.map((r) => ({
    pubkey: r.pubkey,
    role: r.role,
    weight: Number(r.weight),
    seconds: Number(r.secs ?? 0),
    percent: Number(r.weight) / 100,
  }));
}

/** US-C5: seconds of my scenes in published episodes, episodes featured, and sats actually paid to me. */
export async function earnings(db: Db, pubkey: string) {
  const [u] = await db.query<{ secs: number | null; eps: string }>(
    `select sum(cs.out_sec - cs.in_sec) as secs, count(distinct cs.cut_id) as eps
       from cut_scenes cs join cuts c on c.id = cs.cut_id where cs.payee = $1`,
    [pubkey],
  );
  const [p] = await db.query<{ msats: string | null }>(
    "select sum(msats) as msats from payout_paid where pubkey = $1",
    [pubkey],
  );
  return {
    secondsUsed: Number(u?.secs ?? 0),
    episodes: Number(u?.eps ?? 0),
    receivedMsats: Number(p?.msats ?? 0),
  };
}

export async function followGraph(db: Db): Promise<FollowGraph> {
  const g: FollowGraph = new Map();
  for (const r of await db.query<{ pubkey: string; followed: string }>(
    "select pubkey, followed from follows",
  )) {
    let s = g.get(r.pubkey);
    if (!s) g.set(r.pubkey, (s = new Set()));
    s.add(r.followed);
  }
  return g;
}

/** BE-5: scenes not yet in any Cut, ranked by web of trust; unknown authors need PoW to appear. */
export async function inbox(
  db: Db,
  o: { curator: string; storyCoord?: string; minPowBits?: number; limit?: number },
) {
  const items = await db.query<InboxItem>(
    `select s.id, s.author, s.created_at, s.pow_bits from scenes s
      where not exists (select 1 from cut_scenes cs where cs.scene_id = s.id)
        ${o.storyCoord ? "and s.story_coord = $1" : ""}`,
    o.storyCoord ? [o.storyCoord] : [],
  );
  const zaps = new Map<string, number>();
  for (const r of await db.query<{ recipient: string; msats: string }>(
    "select recipient, sum(msats) as msats from zaps group by recipient",
  ))
    zaps.set(r.recipient, Number(r.msats));
  const ranked = rankInbox(
    items.map((i) => ({ ...i, created_at: Number(i.created_at), pow_bits: Number(i.pow_bits) })),
    {
      graph: await followGraph(db),
      roots: [o.curator],
      zaps,
      minPowBits: o.minPowBits,
    },
  );
  return ranked.slice(0, o.limit ?? 100);
}

export async function seriesEpisodes(db: Db, seriesCoord: string) {
  return db.query(
    `select c.* from series_cuts sc join cuts c on c.coord = sc.cut_coord
      where sc.series_coord = $1 order by sc.pos`,
    [seriesCoord],
  );
}
