import {
  credits,
  earnings,
  type Indexer,
  Indexer as Ix,
  inbox,
  ratingSummary,
  reportCounts,
  reviews,
  seriesEpisodes,
  storyTree,
  verifications,
} from "./index";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });

/** Read API over the indexer (BE-4). Everything here is derivable from relays; it is a cache. */
export function createApi(ix: Indexer, port = Number(process.env.PORT ?? 3300)) {
  return Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      const u = new URL(req.url);
      const seg = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      try {
        if (seg[0] === "health") return json({ ok: true, counts: ix.counts });
        if (seg[0] === "stories" && seg.length === 1)
          return json(
            await ix.db.query("select * from stories order by created_at desc limit 100"),
          );
        if (seg[0] === "stories" && seg[2] === "tree" && seg[1])
          return json(await storyTree(ix.db, seg[1]));
        if (seg[0] === "cuts" && seg.length === 1) {
          const series = u.searchParams.get("series");
          return json(
            await ix.db.query(
              `select * from cuts ${series ? "where series_slug = $1 and curator = $2" : ""} order by series_slug, episode`,
              series ? [series, u.searchParams.get("curator")] : [],
            ),
          );
        }
        if (seg[0] === "cuts" && seg[2] === "credits" && seg[1])
          return json(await credits(ix.db, seg[1]));
        if (seg[0] === "cuts" && seg[2] === "scenes" && seg[1])
          return json(
            await ix.db.query("select * from cut_scenes where cut_id = $1 order by pos", [seg[1]]),
          );
        if (seg[0] === "earnings" && seg[1]) return json(await earnings(ix.db, seg[1]));
        if (seg[0] === "inbox") {
          const curator = u.searchParams.get("curator");
          if (!curator) return json({ error: "curator required" }, 400);
          return json(
            await inbox(ix.db, { curator, storyCoord: u.searchParams.get("story") ?? undefined }),
          );
        }
        if (seg[0] === "series" && seg.length === 1)
          return json(await ix.db.query("select * from series order by created_at desc limit 100"));
        if (seg[0] === "series" && seg[2] === "episodes" && seg[1])
          return json(await seriesEpisodes(ix.db, seg[1]));
        if (seg[0] === "ratings" && !seg[1])
          return json(
            await ratingSummary(
              ix.db,
              (u.searchParams.get("cuts") ?? "").split(",").filter(Boolean),
            ),
          );
        if (seg[0] === "ratings" && seg[1]) return json(await reviews(ix.db, seg[1]));
        if (seg[0] === "reports")
          return json(
            await reportCounts(
              ix.db,
              (u.searchParams.get("targets") ?? "").split(",").filter(Boolean),
            ),
          );
        if (seg[0] === "verifications" && seg[1])
          return json(
            await verifications(
              ix.db,
              seg[1],
              u.searchParams.get("trusted")?.split(",").filter(Boolean),
            ),
          );
        if (seg[0] === "scenes" && seg[1])
          return json(
            (await ix.db.query("select * from scenes where id = $1", [seg[1]]))[0] ?? null,
          );
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    },
  });
}

if (import.meta.main) {
  const relays = (process.env.RELAYS ?? "ws://127.0.0.1:3334").split(",");
  const ix = await Ix.open(process.env.DATABASE_URL);
  await ix.follow(relays);
  const s = createApi(ix);
  console.log(`indexer API on :${s.port}, following ${relays.join(", ")}`);
}
