import { decodeInvoice } from "@reelstr/bolt11";
import type { RelayPool, Signer } from "@reelstr/nostr";
import { type EventLike, parseCut, payoutSats, type Weight } from "@reelstr/protocol";
import type { NwcWallet } from "./nwc";

export interface ZapResult {
  paid: { pubkey: string; role: string; sats: number; preimage: string }[];
  failed: { pubkey: string; role: string; sats: number; reason: string }[];
}

export interface ZapOpts {
  /** a Cut event: its `zap` tags (NIP-57 Appendix G) are the recipients and weights */
  cut: EventLike & { id: string };
  sats: number;
  signer: Signer;
  nwc: NwcWallet;
  pool: RelayPool;
  relays: string[];
  comment?: string;
  lnurl?: { fetch?: typeof fetch; urlFor?: (lud16: string) => string };
}

/**
 * PY-1: tip a Cut by zapping every recipient in proportion to its declared weights, paid from the
 * viewer's own wallet. Non-custodial: no Reelstr service ever holds these sats. Zaps are separate
 * payments, so a failure for one recipient does not stop the rest; failures are reported.
 */
export async function zapSplit(o: ZapOpts): Promise<ZapResult> {
  const weights: Weight[] = parseCut(o.cut).weights.filter((w) => w.weight > 0);
  if (weights.length === 0) throw new Error("this Cut declares no split");
  const amounts = payoutSats(weights, o.sats);
  const f = o.lnurl?.fetch ?? fetch;
  const out: ZapResult = { paid: [], failed: [] };
  // the same person can hold several roles: one payment each role's share, merged per pubkey
  const merged = new Map<string, { sats: number; role: string }>();
  weights.forEach((w, i) => {
    const m = merged.get(w.pubkey);
    merged.set(w.pubkey, {
      sats: (m?.sats ?? 0) + (amounts[i] ?? 0),
      role: m ? `${m.role}+${w.role}` : w.role,
    });
  });
  for (const [pubkey, { sats, role }] of merged) {
    if (sats <= 0) continue;
    try {
      const [profile] = (await o.pool.query(o.relays, { kinds: [0], authors: [pubkey] })).sort(
        (a, b) => b.created_at - a.created_at,
      );
      const lud16 = profile ? (JSON.parse(profile.content) as { lud16?: string }).lud16 : undefined;
      if (!lud16) throw new Error("recipient has no Lightning address");
      const [name, domain] = lud16.split("@");
      const meta = (await (
        await f(o.lnurl?.urlFor?.(lud16) ?? `https://${domain}/.well-known/lnurlp/${name}`)
      ).json()) as {
        callback?: string;
        minSendable?: number;
        maxSendable?: number;
        allowsNostr?: boolean;
        nostrPubkey?: string;
      };
      const msats = sats * 1000;
      if (!meta.callback) throw new Error("not an LNURL-pay endpoint");
      if (msats < (meta.minSendable ?? 0) || msats > (meta.maxSendable ?? Number.POSITIVE_INFINITY))
        throw new Error("amount outside the recipient's LNURL limits");
      if (!meta.allowsNostr || !meta.nostrPubkey)
        throw new Error("recipient's LNURL server does not support zaps");
      const req = await o.signer.signEvent({
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relays", ...o.relays],
          ["amount", String(msats)],
          ["p", pubkey],
          ["e", o.cut.id],
          ["a", `31811:${o.cut.pubkey}:${o.cut.tags.find((t) => t[0] === "d")?.[1] ?? ""}`],
        ],
        content: o.comment ?? "",
      });
      const cb = new URL(meta.callback);
      cb.searchParams.set("amount", String(msats));
      cb.searchParams.set("nostr", JSON.stringify(req));
      const { pr } = (await (await f(cb.toString())).json()) as { pr?: string };
      if (!pr) throw new Error("LNURL server returned no invoice");
      if (decodeInvoice(pr).msats !== msats)
        throw new Error("invoice amount does not match the zap");
      const { preimage } = await o.nwc.payInvoice(pr, sats);
      out.paid.push({ pubkey, role, sats, preimage });
    } catch (e) {
      out.failed.push({ pubkey, role, sats, reason: (e as Error).message });
    }
  }
  return out;
}
