import { Database } from "bun:sqlite";
import type { ProofStore, WireProof } from "@reelstr/wallet";

export interface EpisodeRow {
  cut_key: string;
  curator: string;
  d: string;
  key_hex: string;
  iv_hex: string;
  price_sats: number;
  free: number;
  cut_event_id: string;
}

export interface Receipt {
  id: number;
  cut_key: string;
  /** the exact Cut version that was paid for: Cuts are replaceable, so payouts split by this one */
  cut_event_id: string;
  msats: number;
  source: "nutzap" | "ln";
  ref: string;
  created: number;
  paid_out: number;
}

/** SQLite ledger shared by the key server and the split service. Funds live here, so writes are synchronous and transactional. */
export function openLedger(path = ":memory:") {
  const db = new Database(path);
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists meta (k text primary key, v text not null);
    create table if not exists episodes (cut_key text primary key, curator text not null, d text not null, key_hex text not null, iv_hex text not null, price_sats integer not null, free integer not null, cut_event_id text not null);
    create table if not exists invoices (payment_hash text primary key, cut_key text not null, sats integer not null, created integer not null);
    create table if not exists redeemed (ref text primary key, cut_key text not null);
    create table if not exists receipts (id integer primary key autoincrement, cut_key text not null, cut_event_id text not null, msats integer not null, source text not null, ref text not null unique, created integer not null, paid_out integer not null default 0);
    create table if not exists proofs (mint text not null, secret text not null, json text not null, primary key (mint, secret));
    create table if not exists carry (pubkey text primary key, msats integer not null);
    create table if not exists payouts_done (id integer primary key autoincrement, cut_key text not null, period_start integer not null, period_end integer not null, event_id text not null);
  `);
  const meta = (k: string, make: () => string): string => {
    const r = db.query("select v from meta where k = ?").get(k) as { v: string } | null;
    if (r) return r.v;
    const v = make();
    db.query("insert into meta values (?, ?)").run(k, v);
    return v;
  };
  return {
    db,
    meta,
    putEpisode(e: EpisodeRow) {
      db.query("insert or replace into episodes values (?,?,?,?,?,?,?,?)").run(
        e.cut_key,
        e.curator,
        e.d,
        e.key_hex,
        e.iv_hex,
        e.price_sats,
        e.free,
        e.cut_event_id,
      );
    },
    episode: (cutKey: string) =>
      db.query("select * from episodes where cut_key = ?").get(cutKey) as EpisodeRow | null,
    addInvoice: (hash: string, cutKey: string, sats: number) =>
      db
        .query("insert into invoices values (?,?,?,?)")
        .run(hash, cutKey, sats, Math.floor(Date.now() / 1000)),
    invoice: (hash: string) =>
      db.query("select * from invoices where payment_hash = ?").get(hash) as {
        payment_hash: string;
        cut_key: string;
        sats: number;
      } | null,
    /** Record money received. Returns false if this payment ref was already recorded (replay). */
    addReceipt(r: Omit<Receipt, "id" | "created" | "paid_out">): boolean {
      try {
        db.query(
          "insert into receipts (cut_key, cut_event_id, msats, source, ref, created) values (?,?,?,?,?,?)",
        ).run(r.cut_key, r.cut_event_id, r.msats, r.source, r.ref, Math.floor(Date.now() / 1000));
        return true;
      } catch {
        return false;
      }
    },
    receipts: (cutKey?: string) =>
      (cutKey
        ? db.query("select * from receipts where cut_key = ? order by id").all(cutKey)
        : db.query("select * from receipts order by id").all()) as Receipt[],
    proofStore(mint: string): ProofStore {
      return {
        async load() {
          return (
            db.query("select json from proofs where mint = ?").all(mint) as { json: string }[]
          ).map((r) => JSON.parse(r.json) as WireProof);
        },
        async save(proofs) {
          db.transaction(() => {
            db.query("delete from proofs where mint = ?").run(mint);
            for (const p of proofs)
              db.query("insert into proofs values (?,?,?)").run(mint, p.secret, JSON.stringify(p));
          })();
        },
      };
    },
  };
}
export type Ledger = ReturnType<typeof openLedger>;
