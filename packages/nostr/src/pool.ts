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

  /**
   * Publish to every relay; throws if fewer than `minAcks` accept (FE-2 wants 2+). A relay that
   * fails because its connection died (an idle socket dropped by the server or a proxy, or a relay
   * restart) is reconnected and tried once more. A relay's own refusal ("blocked:", "pow:") is an
   * answer and is never retried. Republishing the same signed event is harmless.
   */
  async publish(event: NostrEvent, relays: string[], minAcks = 1): Promise<PublishReport> {
    const attempt = async (rs: string[]) => {
      const results = await Promise.allSettled(this.pool.publish(rs, event));
      return results.map((r, i) => ({
        relay: rs[i] ?? "?",
        ok: r.status === "fulfilled",
        reason: r.status === "rejected" ? String((r.reason as Error)?.message ?? r.reason) : "",
      }));
    };
    let outcome = await attempt(relays);
    const dead = outcome.filter(
      (o) =>
        !o.ok &&
        /connection closed|connection error|not connected|closed|ECONNRESET|ECONNREFUSED|timed out|WebSocket/i.test(
          o.reason,
        ) &&
        !/blocked|pow:|invalid|rejected|rate/i.test(o.reason),
    );
    if (dead.length > 0) {
      const urls = dead.map((d) => d.relay);
      this.pool.close(urls); // drop the stale sockets so the next publish opens fresh ones
      const retried = await attempt(urls);
      outcome = outcome.map((o) => retried.find((r) => r.relay === o.relay) ?? o);
    }
    const report: PublishReport = { event, ok: [], failed: [] };
    for (const o of outcome) {
      if (o.ok) report.ok.push(o.relay);
      else report.failed.push({ relay: o.relay, reason: o.reason });
    }
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
