import { RelayPool } from "@reelstr/nostr";
import { KIND } from "@reelstr/protocol";
import { type Ev, INDEXED_KINDS, type IngestResult, ingest, rebuild } from "./apply";
import { type Db, openDb } from "./db";
import { migrate } from "./schema";

export * from "./apply";
export * from "./db";
export * from "./queries";
export * from "./schema";
export * from "./wot";

export class Indexer {
  readonly pool = new RelayPool();
  private subs: { close: () => void }[] = [];
  readonly counts: Record<IngestResult, number> = { stored: 0, duplicate: 0, rejected: 0 };
  private constructor(readonly db: Db) {}

  static async open(url?: string, opts: { schema?: string } = {}) {
    const db = await openDb(url, opts);
    await migrate(db);
    return new Indexer(db);
  }

  async ingest(e: Ev) {
    const r = await ingest(this.db, e);
    this.counts[r.result]++;
    return r;
  }

  /**
   * Index everything on the relays, then keep listening. One subscription with no `since` serves
   * both: the relay replays what it has, then forwards new events. A `since: now` live filter would
   * silently drop any event whose created_at is older than the moment we subscribed (clock-skewed
   * clients, late relaying, backfills). Ingest is idempotent, so replays are harmless.
   * Resolves once the relays have replayed their history and every replayed event is ingested.
   */
  async follow(relays: string[], opts: { since?: number; syncTimeoutMs?: number } = {}) {
    const inflight = new Set<Promise<unknown>>();
    const take = (e: Ev) => {
      const p = this.ingest(e).finally(() => inflight.delete(p));
      inflight.add(p);
    };
    await new Promise<void>((resolve) => {
      const sub = this.pool.subscribe(
        relays,
        { kinds: [...INDEXED_KINDS], since: opts.since },
        (e) => take(e as Ev),
        resolve,
      );
      this.subs.push(sub as unknown as { close: () => void });
      setTimeout(resolve, opts.syncTimeoutMs ?? 20_000);
    });
    while (inflight.size) await Promise.all([...inflight]);
  }

  rebuild() {
    return rebuild(this.db);
  }

  async close() {
    for (const s of this.subs) s.close();
    await this.db.close();
  }
}

export { KIND };
