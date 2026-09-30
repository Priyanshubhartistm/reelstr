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

  static async open(url?: string) {
    const db = await openDb(url);
    await migrate(db);
    return new Indexer(db);
  }

  async ingest(e: Ev) {
    const r = await ingest(this.db, e);
    this.counts[r.result]++;
    return r;
  }

  /** Pull everything currently on the relays, then keep listening. */
  async follow(relays: string[], opts: { since?: number } = {}) {
    const filter = { kinds: [...INDEXED_KINDS], since: opts.since };
    for (const e of await this.pool.query(relays, filter)) await this.ingest(e as Ev);
    const sub = this.pool.subscribe(
      relays,
      { ...filter, since: Math.floor(Date.now() / 1000) - 5 },
      (e) => void this.ingest(e as Ev),
    );
    this.subs.push(sub as unknown as { close: () => void });
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
