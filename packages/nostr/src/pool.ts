import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import type { NostrEvent } from "nostr-tools/pure";

export type { Filter, NostrEvent };

export interface PublishReport {
  event: NostrEvent;
  ok: string[];
  failed: { relay: string; reason: string }[];
}

export class RelayPool {
  private readonly pool = new SimplePool();

  /** Publish to every relay; throws if fewer than `minAcks` accept (FE-2 wants 2+). */
  async publish(event: NostrEvent, relays: string[], minAcks = 1): Promise<PublishReport> {
    const results = await Promise.allSettled(this.pool.publish(relays, event));
    const report: PublishReport = { event, ok: [], failed: [] };
    results.forEach((r, i) => {
      const relay = relays[i] ?? "?";
      if (r.status === "fulfilled") report.ok.push(relay);
      else report.failed.push({ relay, reason: String((r.reason as Error)?.message ?? r.reason) });
    });
    if (report.ok.length < minAcks)
      throw new Error(
        `published to ${report.ok.length}/${minAcks} required relays: ${report.failed.map((f) => `${f.relay}: ${f.reason}`).join("; ")}`,
      );
    return report;
  }

  query(relays: string[], filter: Filter): Promise<NostrEvent[]> {
    return this.pool.querySync(relays, filter);
  }

  async get(relays: string[], filter: Filter): Promise<NostrEvent | null> {
    return this.pool.get(relays, filter);
  }

  subscribe(
    relays: string[],
    filter: Filter,
    onevent: (e: NostrEvent) => void,
    oneose?: () => void,
  ) {
    return this.pool.subscribe(relays, filter, { onevent, oneose });
  }

  close(relays: string[]) {
    this.pool.close(relays);
  }
}
