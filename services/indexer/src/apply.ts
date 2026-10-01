import {
  coordinate,
  type EventLike,
  KIND,
  manifestEligibleForVerification,
  NS_RATING,
  NS_VERIFIED,
  parseCut,
  parseRating,
  parseScene,
  parseVerification,
  tagsOf,
  tagValue,
  validateEvent,
  verifySignature,
} from "@reelstr/protocol";
import type { Db } from "./db";
import { powBits } from "./wot";

export type Ev = EventLike & { id: string; created_at: number; sig: string };

export const INDEXED_KINDS = [
  KIND.SCENE,
  KIND.STORY,
  KIND.CUT,
  KIND.SERIES,
  KIND.PAYOUT,
  KIND.REPORT,
  KIND.LABEL,
  3,
  9735,
] as const;

type Versioned = { created_at: string | number; id: string } | undefined;
/** NIP-01: the newer event wins; ties go to the lowest id. */
const isNewer = (old: Versioned, e: Ev) =>
  !old ||
  e.created_at > Number(old.created_at) ||
  (e.created_at === Number(old.created_at) && e.id < old.id);

/** Update derived tables from one event. Idempotent and independent of arrival order. */
export async function applyDerived(db: Db, e: Ev): Promise<void> {
  const d = tagValue(e.tags, "d") ?? "";
  switch (e.kind) {
    case KIND.SCENE: {
      const s = parseScene(e);
      await db.query(
        `insert into scenes values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) on conflict do nothing`,
        [
          e.id,
          s.author,
          s.payee,
          s.storyCoord,
          s.parentId ?? null,
          s.videoSha,
          s.duration,
          s.title,
          s.license,
          manifestEligibleForVerification(e),
          powBits(e.id),
          e.created_at,
          s.content,
          JSON.stringify(s.gen),
          s.videoUrl,
        ],
      );
      break;
    }
    case KIND.STORY: {
      const coord = coordinate(KIND.STORY, e.pubkey, d);
      const [old] = await db.query<{ created_at: string; id: string }>(
        "select created_at, id from stories where coord=$1",
        [coord],
      );
      if (!isNewer(old, e)) break;
      await db.query("delete from stories where coord=$1", [coord]);
      await db.query("insert into stories values ($1,$2,$3,$4,$5,$6,$7,$8)", [
        coord,
        e.id,
        e.pubkey,
        d,
        tagValue(e.tags, "title") ?? "",
        e.content,
        tagValue(e.tags, "license") ?? "",
        e.created_at,
      ]);
      break;
    }
    case KIND.CUT: {
      const c = parseCut(e);
      const coord = coordinate(KIND.CUT, e.pubkey, d);
      const [old] = await db.query<{ created_at: string; id: string }>(
        "select created_at, id from cuts where coord=$1",
        [coord],
      );
      if (!isNewer(old, e)) break;
      if (old) {
        await db.query("delete from cut_scenes where cut_id=$1", [old.id]);
        await db.query("delete from cut_weights where cut_id=$1", [old.id]);
        await db.query("delete from cuts where coord=$1", [coord]);
      }
      await db.query("insert into cuts values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [
        coord,
        e.id,
        e.pubkey,
        c.seriesSlug,
        c.episode,
        c.title,
        c.durationSec,
        c.price.amount,
        c.hlsUrl ?? null,
        e.created_at,
        c.contentWarning ?? null,
        JSON.stringify(c.captions),
      ]);
      for (const [i, s] of c.scenes.entries())
        await db.query("insert into cut_scenes values ($1,$2,$3,$4,$5,$6,$7)", [
          e.id,
          i,
          s.id,
          s.sha256,
          s.inSec,
          s.outSec,
          s.payee,
        ]);
      for (const w of c.weights)
        await db.query("insert into cut_weights values ($1,$2,$3,$4)", [
          e.id,
          w.pubkey,
          w.role,
          w.weight,
        ]);
      break;
    }
    case KIND.SERIES: {
      const coord = coordinate(KIND.SERIES, e.pubkey, d);
      const [old] = await db.query<{ created_at: string; id: string }>(
        "select created_at, id from series where coord=$1",
        [coord],
      );
      if (!isNewer(old, e)) break;
      await db.query("delete from series_cuts where series_coord=$1", [coord]);
      await db.query("delete from series where coord=$1", [coord]);
      await db.query("insert into series values ($1,$2,$3,$4,$5,$6,$7,$8)", [
        coord,
        e.id,
        e.pubkey,
        d,
        tagValue(e.tags, "title") ?? "",
        e.content,
        Number(tagValue(e.tags, "free") ?? 0),
        e.created_at,
      ]);
      for (const [i, t] of tagsOf(e.tags, "a").entries())
        await db.query("insert into series_cuts values ($1,$2,$3)", [coord, i, t[1] ?? ""]);
      break;
    }
    case KIND.PAYOUT: {
      await db.query(
        "insert into payouts values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [
          e.id,
          tagValue(e.tags, "e") ?? "",
          tagValue(e.tags, "a") ?? "",
          Number(tagValue(e.tags, "total")),
          Number(tagValue(e.tags, "fee") ?? 0),
          Number(tagsOf(e.tags, "period")[0]?.[1]),
          Number(tagsOf(e.tags, "period")[0]?.[2]),
          e.created_at,
        ],
      );
      await db.query("delete from payout_paid where payout_id=$1", [e.id]);
      for (const t of tagsOf(e.tags, "paid"))
        await db.query("insert into payout_paid values ($1,$2,$3,$4,$5)", [
          e.id,
          t[1],
          Number(t[2]),
          t[3],
          t[4],
        ]);
      break;
    }
    case KIND.LABEL: {
      if (e.tags.some((t) => t[0] === "L" && t[1] === NS_RATING)) {
        const r = parseRating(e);
        const [old] = await db.query<{ created_at: string }>(
          "select created_at from ratings where cut_id=$1 and rater=$2",
          [r.cutId, r.rater],
        );
        if (old && Number(old.created_at) >= e.created_at) break; // one rating per rater per Cut: the newest wins
        await db.query("delete from ratings where cut_id=$1 and rater=$2", [r.cutId, r.rater]);
        await db.query("insert into ratings values ($1,$2,$3,$4,$5)", [
          r.cutId,
          r.rater,
          r.stars,
          r.review,
          e.created_at,
        ]);
      } else if (e.tags.some((t) => t[0] === "L" && t[1] === NS_VERIFIED)) {
        const v = parseVerification(e);
        await db.query(
          "insert into verifications values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
          [
            e.id,
            v.sceneId,
            v.verifier,
            v.verdict,
            v.similarity ?? null,
            v.exact,
            v.engine,
            e.created_at,
          ],
        );
      }
      break;
    }
    case KIND.REPORT: {
      const t = tagsOf(e.tags, "e")[0];
      await db.query("insert into reports values ($1,$2,$3,$4,$5) on conflict do nothing", [
        e.id,
        t?.[1],
        e.pubkey,
        t?.[2] ?? "other",
        e.created_at,
      ]);
      break;
    }
    case 9735: {
      // amount comes from the embedded zap request; it is a claim, not proof of payment (NIP-57),
      // so it is only ever a ranking tie-break, never money accounting
      const recipient = tagValue(e.tags, "p");
      const desc = tagValue(e.tags, "description");
      if (!recipient || !desc) break;
      try {
        const req = JSON.parse(desc) as { tags?: string[][] };
        const amount = Number(req.tags?.find((t) => t[0] === "amount")?.[1]);
        if (Number.isFinite(amount) && amount > 0)
          await db.query("insert into zaps values ($1,$2,$3) on conflict do nothing", [
            e.id,
            recipient,
            amount,
          ]);
      } catch {}
      break;
    }
    case 3: {
      const [old] = await db.query<{ created_at: string }>(
        "select created_at from follow_versions where pubkey=$1",
        [e.pubkey],
      );
      if (old && Number(old.created_at) >= e.created_at) break;
      await db.query("delete from follows where pubkey=$1", [e.pubkey]);
      await db.query("delete from follow_versions where pubkey=$1", [e.pubkey]);
      await db.query("insert into follow_versions values ($1,$2)", [e.pubkey, e.created_at]);
      for (const t of tagsOf(e.tags, "p"))
        if (/^[0-9a-f]{64}$/.test(t[1] ?? ""))
          await db.query("insert into follows values ($1,$2) on conflict do nothing", [
            e.pubkey,
            t[1],
          ]);
      break;
    }
  }
}

export type IngestResult = "stored" | "duplicate" | "rejected";

/** Validate, store in `events`, update derived tables. Invalid events never reach the graph. */
export async function ingest(db: Db, e: Ev): Promise<{ result: IngestResult; reasons?: string[] }> {
  const reelstr = e.kind !== 3 && e.kind !== 9735;
  // labels other than ours (other apps use kind 1985 too) are not ours to index or reject
  if (
    e.kind === KIND.LABEL &&
    !e.tags.some((t) => t[0] === "L" && (t[1] === NS_RATING || t[1] === NS_VERIFIED))
  )
    return { result: "duplicate" };
  const errors = reelstr
    ? validateEvent(e, { verifySig: true }).errors
    : verifySignature(e)
      ? []
      : ["invalid event id or signature"];
  if (errors.length > 0) {
    await db.query("insert into rejected values ($1,$2,$3) on conflict do nothing", [
      e.id,
      e.kind,
      errors.join("; "),
    ]);
    return { result: "rejected", reasons: errors };
  }
  const exists = await db.query("select 1 from events where id=$1", [e.id]);
  if (exists.length) return { result: "duplicate" };
  await db.tx(async (t) => {
    await t.query("insert into events values ($1,$2,$3,$4,$5,$6)", [
      e.id,
      e.kind,
      e.pubkey,
      e.created_at,
      tagValue(e.tags, "d") ?? null,
      JSON.stringify(e),
    ]);
    await applyDerived(t, e);
  });
  return { result: "stored" };
}

/** Rebuild every derived table from `events` alone (BE-4: nothing exists only in the indexer). */
export async function rebuild(db: Db): Promise<number> {
  const { resetDerived } = await import("./schema");
  await resetDerived(db);
  const rows = await db.query<{ raw: string }>("select raw from events order by created_at, id");
  for (const r of rows) await applyDerived(db, JSON.parse(r.raw) as Ev);
  return rows.length;
}
