import type { Db } from "./db";

/** `events` is the only source of truth; every other table is derived and rebuildable from it. */
export const DERIVED = [
  "cut_weights",
  "cut_scenes",
  "cuts",
  "series_cuts",
  "series",
  "scenes",
  "stories",
  "payout_paid",
  "payouts",
  "zaps",
  "follows",
];

export async function migrate(db: Db) {
  await db.exec(`
    create table if not exists events (
      id text primary key, kind int not null, pubkey text not null, created_at bigint not null,
      d text, raw text not null
    );
    create index if not exists events_kind on events(kind, created_at);
    create table if not exists rejected (id text primary key, kind int, reason text not null);

    create table if not exists stories (
      coord text primary key, id text not null, pubkey text not null, d text not null,
      title text not null, logline text not null, license text not null, created_at bigint not null
    );
    create table if not exists scenes (
      id text primary key, author text not null, payee text not null, story_coord text not null,
      parent_id text, video_sha text not null, duration double precision not null,
      title text not null, license text not null, eligible boolean not null,
      pow_bits int not null, created_at bigint not null
    );
    create index if not exists scenes_story on scenes(story_coord);
    create index if not exists scenes_parent on scenes(parent_id);
    create table if not exists cuts (
      coord text primary key, id text not null, curator text not null, series_slug text not null,
      episode int not null, title text not null, duration double precision not null,
      price bigint not null, hls_url text, created_at bigint not null
    );
    create table if not exists cut_scenes (
      cut_id text not null, pos int not null, scene_id text not null, sha text not null,
      in_sec double precision not null, out_sec double precision not null, payee text not null,
      primary key (cut_id, pos)
    );
    create index if not exists cut_scenes_scene on cut_scenes(scene_id);
    create table if not exists cut_weights (
      cut_id text not null, pubkey text not null, role text not null, weight int not null
    );
    create table if not exists series (
      coord text primary key, id text not null, curator text not null, slug text not null,
      title text not null, summary text not null, free int not null, created_at bigint not null
    );
    create table if not exists series_cuts (series_coord text not null, pos int not null, cut_coord text not null, primary key (series_coord, pos));
    create table if not exists payouts (
      id text primary key, cut_id text not null, cut_coord text not null, total_msats bigint not null,
      fee_msats bigint not null, period_start bigint not null, period_end bigint not null, created_at bigint not null
    );
    create table if not exists payout_paid (payout_id text not null, pubkey text not null, msats bigint not null, proof text not null, proof_type text not null);
    create table if not exists zaps (receipt_id text primary key, recipient text not null, msats bigint not null);
    create table if not exists follows (pubkey text not null, followed text not null, primary key (pubkey, followed));
    create table if not exists follow_versions (pubkey text primary key, created_at bigint not null);
  `);
}

export async function resetDerived(db: Db) {
  for (const t of DERIVED) await db.exec(`delete from ${t}`);
  await db.exec("delete from follow_versions");
}
