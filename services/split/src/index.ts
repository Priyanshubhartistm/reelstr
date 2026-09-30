import { decodeInvoice, paymentHashOf } from "@reelstr/bolt11";
import type { Ledger, LnBackend } from "@reelstr/keys";
import type { RelayPool, Signer } from "@reelstr/nostr";
import {
  buildPayout,
  coordinate,
  KIND,
  parseCut,
  planPayout,
  validateEvent,
  type Weight,
} from "@reelstr/protocol";
import { buildNutzap, type CashuWallet, parseNutzapInfo } from "@reelstr/wallet";

export interface SplitOpts {
  /**
   * This service holds viewers' money between unlock and payout, which can make its operator a
   * money transmitter. It refuses to run until the operator says they have taken that on.
   */
  acknowledgeCustody: boolean;
  ledger: Ledger;
  pool: RelayPool;
  relays: string[];
  /** signs nutzaps and payout receipts */
  identity: Signer;
  /** mints the service holds funds at */
  mints: string[];
  walletFor: (mint: string) => Promise<CashuWallet>;
  ln?: LnBackend;
  lnurl?: { fetch?: typeof fetch; urlFor?: (lud16: string) => string };
  feeMsats?: (totalMsats: number) => number;
  dustMsats?: number;
}

export interface PaidRow {
  pubkey: string;
  msats: number;
  proof: string;
  proofType: "nutzap" | "ln";
}
export interface Batch {
  cutEventId: string;
  cutKey: string;
  totalMsats: number;
  priorCarryMsats: number;
  paid: PaidRow[];
  carried: { pubkey: string; msats: number; why: string }[];
  receiptEventId?: string;
}
export interface Report {
  batches: Batch[];
  skipped: { cutEventId: string; reason: string }[];
  /** receipts reserved by an earlier run that never finished: money may have moved, needs a human */
  stuck: number;
}

const sats = (msats: number) => Math.floor(msats / 1000);

/** Nutzap to the recipient's kind 10019 key, at a mint we both use. Returns the nutzap event id. */
async function payNutzap(
  o: SplitOpts,
  pubkey: string,
  msats: number,
  cutEventId: string,
): Promise<PaidRow> {
  const [info] = (await o.pool.query(o.relays, { kinds: [10019], authors: [pubkey] })).sort(
    (a, b) => b.created_at - a.created_at,
  );
  if (!info) throw new Error("no nutzap info (kind 10019)");
  const i = parseNutzapInfo(info);
  const mint = i.mints.find((m) => o.mints.includes(m));
  if (!mint) throw new Error("no mint in common with the recipient");
  const w = await o.walletFor(mint);
  const n = sats(msats);
  if (w.balance() < n)
    throw new Error(`service wallet at ${mint} holds ${w.balance()} sats, needs ${n}`);
  const proofs = await w.lockedSend(n, i.p2pk);
  const ev = await o.identity.signEvent(
    buildNutzap({
      proofs,
      mintUrl: mint,
      recipient: pubkey,
      eventId: cutEventId,
      comment: "Reelstr payout",
    }),
  );
  await o.pool.publish(ev, [...new Set([...i.relays, ...o.relays])]);
  return { pubkey, msats: n * 1000, proof: ev.id, proofType: "nutzap" };
}

/** Lightning address fallback: kind 0 lud16 -> LNURL-pay -> invoice -> pay. The preimage is the proof. */
async function payLightningAddress(o: SplitOpts, pubkey: string, msats: number): Promise<PaidRow> {
  if (!o.ln) throw new Error("no Lightning backend");
  const [profile] = (await o.pool.query(o.relays, { kinds: [0], authors: [pubkey] })).sort(
    (a, b) => b.created_at - a.created_at,
  );
  const lud16 = profile ? (JSON.parse(profile.content) as { lud16?: string }).lud16 : undefined;
  if (!lud16) throw new Error("no Lightning address");
  const [name, domain] = lud16.split("@");
  const f = o.lnurl?.fetch ?? fetch;
  const base = o.lnurl?.urlFor?.(lud16) ?? `https://${domain}/.well-known/lnurlp/${name}`;
  const meta = (await (await f(base)).json()) as {
    callback?: string;
    minSendable?: number;
    maxSendable?: number;
  };
  const amt = sats(msats) * 1000;
  if (
    !meta.callback ||
    amt < (meta.minSendable ?? 0) ||
    amt > (meta.maxSendable ?? Number.POSITIVE_INFINITY)
  )
    throw new Error("LNURL amount out of range");
  const cb = new URL(meta.callback);
  cb.searchParams.set("amount", String(amt));
  const { pr } = (await (await f(cb.toString())).json()) as { pr?: string };
  if (!pr) throw new Error("LNURL returned no invoice");
  const inv = decodeInvoice(pr);
  if (inv.msats !== amt)
    throw new Error(`LNURL invoice is for ${inv.msats} msats, expected ${amt}`);
  const { preimage } = await o.ln.payInvoice(pr);
  if (paymentHashOf(preimage) !== inv.paymentHash)
    throw new Error("preimage does not match the invoice");
  return { pubkey, msats: amt, proof: preimage, proofType: "ln" };
}

/**
 * Pay out everything received since the last run (BE-7). Per Cut version: split by the signed
 * weights, pay by nutzap or Lightning address, carry what cannot be paid, publish a receipt.
 */
export async function runPayouts(o: SplitOpts): Promise<Report> {
  if (!o.acknowledgeCustody)
    throw new Error(
      "split service is custodial: set acknowledgeCustody to confirm you accept that responsibility",
    );
  const { db } = o.ledger;
  const report: Report = {
    batches: [],
    skipped: [],
    stuck: (
      db.query("select count(*) as n from receipts where paid_out = 2").get() as { n: number }
    ).n,
  };
  const rows = o.ledger.receipts().filter((r) => r.paid_out === 0);
  const byCut = new Map<string, typeof rows>();
  for (const r of rows) byCut.set(r.cut_event_id, [...(byCut.get(r.cut_event_id) ?? []), r]);

  for (const [cutEventId, rs] of byCut) {
    const cutEv = await o.pool.get(o.relays, { ids: [cutEventId] });
    if (!cutEv) {
      report.skipped.push({ cutEventId, reason: "Cut event not found on relays" });
      continue;
    }
    const v = validateEvent(cutEv, { verifySig: true });
    if (!v.ok) {
      report.skipped.push({ cutEventId, reason: `Cut is invalid: ${v.errors.join("; ")}` });
      continue;
    }
    const cut = parseCut(cutEv);
    const weights: Weight[] = cut.weights.filter((w) => w.weight > 0);
    const cutKey = rs[0]?.cut_key ?? "";
    const total = rs.reduce((a, r) => a + r.msats, 0);
    const prior = new Map<string, number>();
    for (const w of weights) {
      const c = db.query("select msats from carry where pubkey = ?").get(w.pubkey) as {
        msats: number;
      } | null;
      if (c) prior.set(w.pubkey, c.msats);
    }
    const priorTotal = [...prior.values()].reduce((a, b) => a + b, 0);
    const plan = planPayout(weights, total, {
      feeMsats: o.feeMsats?.(total) ?? 0,
      priorCarry: prior,
      dustMsats: o.dustMsats,
    });

    // write-ahead: reserve first. If we die mid-payout these stay at 2 and a human looks; we never retry blind.
    const ids = rs.map((r) => r.id);
    db.query(`update receipts set paid_out = 2 where id in (${ids.join(",")})`).run();

    const batch: Batch = {
      cutEventId,
      cutKey,
      totalMsats: total,
      priorCarryMsats: priorTotal,
      paid: [],
      carried: [],
    };
    const carryNow = new Map<string, number>();
    const carryWhy = new Map<string, string>();
    const addCarry = (pk: string, m: number, why: string) => {
      if (m <= 0) return;
      carryNow.set(pk, (carryNow.get(pk) ?? 0) + m);
      carryWhy.set(pk, why);
    };
    for (const c of plan.carry) addCarry(c.pubkey, c.msats, "below the dust threshold");
    for (const p of plan.paid) {
      let done: PaidRow | undefined;
      const errs: string[] = [];
      for (const rail of [
        () => payNutzap(o, p.pubkey, p.msats, cutEventId),
        () => payLightningAddress(o, p.pubkey, p.msats),
      ]) {
        try {
          done = await rail();
          break;
        } catch (e) {
          errs.push((e as Error).message);
        }
      }
      if (done) {
        batch.paid.push(done);
        addCarry(p.pubkey, p.msats - done.msats, "sub-sat remainder");
      } else addCarry(p.pubkey, p.msats, `no payout rail worked (${errs.join("; ")})`);
    }

    db.transaction(() => {
      for (const pk of prior.keys()) db.query("delete from carry where pubkey = ?").run(pk);
      for (const [pk, m] of carryNow)
        db.query("insert or replace into carry values (?, ?)").run(pk, m);
    })();
    batch.carried = [...carryNow].map(([pubkey, msats]) => ({
      pubkey,
      msats,
      why: carryWhy.get(pubkey) ?? "",
    }));

    const times = rs.map((r) => r.created);
    const receipt = await o.identity.signEvent(
      buildPayout({
        cutId: cutEventId,
        cutCoord: coordinate(KIND.CUT, cut.curator, cut.d),
        weights,
        periodStart: Math.min(...times),
        periodEnd: Math.max(...times),
        totalMsats: total,
        feeMsats: o.feeMsats?.(total) ?? 0,
        priorCarryMsats: priorTotal,
        paid: batch.paid,
        carry: [...carryNow].map(([pubkey, msats]) => ({ pubkey, msats })),
      }),
    );
    const rv = validateEvent(receipt, { verifySig: true });
    if (!rv.ok) {
      report.skipped.push({
        cutEventId,
        reason: `own receipt invalid, left reserved: ${rv.errors.join("; ")}`,
      });
      report.stuck += rs.length;
      continue;
    }
    try {
      await o.pool.publish(receipt, o.relays);
    } catch (e) {
      report.skipped.push({
        cutEventId,
        reason: `paid but could not publish receipt (left reserved): ${(e as Error).message}`,
      });
      report.stuck += rs.length;
      continue;
    }
    batch.receiptEventId = receipt.id;
    db.query(`update receipts set paid_out = 1 where id in (${ids.join(",")})`).run();
    db.query(
      "insert into payouts_done (cut_key, period_start, period_end, event_id) values (?,?,?,?)",
    ).run(cutKey, Math.min(...times), Math.max(...times), receipt.id);
    report.batches.push(batch);
  }
  return report;
}
