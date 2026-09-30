import { KIND, WEIGHT_TOTAL } from "./kinds";
import { Collector, type EventLike, type EventTemplate, type Validation } from "./result";
import { apportion, type Weight } from "./split";
import { isHex64, tagsOf, tagValue } from "./tags";

/** below this, balances carry to the next batch (PY-3) */
export const DUST_MSATS = 21_000;

export type ProofType = "nutzap" | "ln";

export interface PayoutPlan {
  paid: { pubkey: string; msats: number }[];
  carry: { pubkey: string; msats: number }[];
}

/**
 * Split `totalMsats` (minus fee) by weight, add any carried balance, then pay
 * everyone at or above dust and carry the rest. Invariant: sum(paid)+sum(carry)+fee == total+priorCarry.
 */
export function planPayout(
  weights: Weight[],
  totalMsats: number,
  opts: { feeMsats?: number; priorCarry?: Map<string, number>; dustMsats?: number } = {},
): PayoutPlan {
  const fee = opts.feeMsats ?? 0;
  const dust = opts.dustMsats ?? DUST_MSATS;
  if (fee < 0 || fee > totalMsats) throw new Error("fee out of range");
  const net = totalMsats - fee;
  // same pubkey may hold several roles; merge before the dust test
  const gross = new Map<string, number>();
  const shares =
    net > 0
      ? apportion(
          weights.map((w) => w.weight),
          net,
        )
      : weights.map(() => 0);
  for (const [i, w] of weights.entries())
    gross.set(w.pubkey, (gross.get(w.pubkey) ?? 0) + (shares[i] ?? 0));
  for (const [pk, m] of opts.priorCarry ?? []) gross.set(pk, (gross.get(pk) ?? 0) + m);
  const plan: PayoutPlan = { paid: [], carry: [] };
  for (const [pubkey, msats] of gross)
    (msats >= dust ? plan.paid : plan.carry).push({ pubkey, msats });
  return plan;
}

export interface PayoutParams {
  /** the exact Cut event id paid against (Cuts are replaceable, so copy the weights) */
  cutId: string;
  cutCoord: string;
  weights: Weight[];
  periodStart: number;
  periodEnd: number;
  totalMsats: number;
  feeMsats?: number;
  paid: { pubkey: string; msats: number; proof: string; proofType: ProofType }[];
  carry?: { pubkey: string; msats: number }[];
  createdAt?: number;
}

export function buildPayout(p: PayoutParams): EventTemplate {
  const tags: string[][] = [
    ["e", p.cutId],
    ["a", p.cutCoord],
    ["period", String(p.periodStart), String(p.periodEnd)],
    ["total", String(p.totalMsats)],
    ["fee", String(p.feeMsats ?? 0)],
  ];
  for (const w of p.weights) tags.push(["zap", w.pubkey, "", String(w.weight), w.role]);
  for (const x of p.paid) tags.push(["paid", x.pubkey, String(x.msats), x.proof, x.proofType]);
  for (const x of p.carry ?? []) tags.push(["carry", x.pubkey, String(x.msats)]);
  return {
    kind: KIND.PAYOUT,
    created_at: p.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
}

/**
 * `priorCarryMsats` is what the service already owed from earlier batches; the receipt only
 * balances when it is supplied (sum(paid)+sum(carry)+fee == total + priorCarry).
 */
export function validatePayout(e: EventLike, priorCarryMsats = 0): Validation {
  const c = new Collector();
  if (e.kind !== KIND.PAYOUT) c.err(`kind must be ${KIND.PAYOUT}`);
  if (!isHex64(tagValue(e.tags, "e"))) c.err("missing e tag with the Cut event id");
  const period = tagsOf(e.tags, "period")[0];
  if (
    !period ||
    !/^\d+$/.test(period[1] ?? "") ||
    !/^\d+$/.test(period[2] ?? "") ||
    Number(period[2]) < Number(period[1])
  )
    c.err("period must be [period, start, end] with end >= start");
  const total = Number(tagValue(e.tags, "total"));
  const fee = Number(tagValue(e.tags, "fee") ?? 0);
  if (!Number.isInteger(total) || total < 0) c.err("total must be a non-negative integer (msats)");
  if (!Number.isInteger(fee) || fee < 0) c.err("fee must be a non-negative integer (msats)");

  const zaps = tagsOf(e.tags, "zap");
  const wsum = zaps.reduce((a, t) => a + Number(t[3]), 0);
  if (zaps.length === 0) c.err("receipt must copy the zap weights it paid against");
  else if (wsum !== WEIGHT_TOTAL)
    c.err(`copied zap weights sum to ${wsum}, must be ${WEIGHT_TOTAL}`);

  let out = 0;
  for (const [i, t] of tagsOf(e.tags, "paid").entries()) {
    if (!isHex64(t[1])) c.err(`paid[${i}]: pubkey must be 64 hex`);
    if (!/^\d+$/.test(t[2] ?? "")) c.err(`paid[${i}]: msats must be an integer`);
    if (!isHex64(t[3])) c.err(`paid[${i}]: proof must be a 64-hex nutzap event id or preimage`);
    if (t[4] !== "nutzap" && t[4] !== "ln") c.err(`paid[${i}]: proof type must be nutzap|ln`);
    if (Number(t[2]) < DUST_MSATS) c.warn(`paid[${i}]: below dust threshold`);
    out += Number(t[2]);
  }
  for (const [i, t] of tagsOf(e.tags, "carry").entries()) {
    if (!isHex64(t[1]) || !/^\d+$/.test(t[2] ?? "")) c.err(`carry[${i}] malformed`);
    out += Number(t[2]);
  }
  if (Number.isInteger(total) && out + fee !== total + priorCarryMsats)
    c.err(`paid+carry+fee (${out + fee}) != total+priorCarry (${total + priorCarryMsats})`);
  return c.result();
}
