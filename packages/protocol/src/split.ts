import { WEIGHT_TOTAL } from "./kinds";

export interface SceneUse {
  /** who is paid for this scene (creator, or commissioner for agent scenes) */
  payee: string;
  inSec: number;
  outSec: number;
}

export interface SplitInput {
  scenes: SceneUse[];
  audioBed?: { payee: string /** bps of the creator pool, default 1000 */; poolBps?: number };
  /** bps of the 10,000 total */
  curatorBps: number;
  hostBps: number;
  curator: string;
  host: string;
}

export interface Weight {
  pubkey: string;
  role: "creator" | "audio" | "curator" | "host";
  weight: number;
}

export const DEFAULT_AUDIO_BED_BPS = 1000;
const ms = (s: number) => Math.round(s * 1000);

/**
 * Largest-remainder apportionment of `total` over integer `quotas`: exact, deterministic,
 * sums to `total`. Ties break on index so every client computes the same weights.
 */
export function apportion(quotas: number[], total: number): number[] {
  const sum = quotas.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("apportion: no positive quota");
  const base = quotas.map((q) => Math.floor((q * total) / sum));
  const rem = quotas.map((q, i) => ({ i, r: (q * total) % sum }));
  let left = total - base.reduce((a, b) => a + b, 0);
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rem) {
    if (left-- <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
  }
  return base;
}

/**
 * Creator weight = that payee's trimmed seconds / episode seconds x creator pool.
 * Audio bed takes `poolBps` of the pool first. Curator and host get declared shares.
 * Payees with several scenes are aggregated; output is ordered creators (by first use),
 * audio, curator, host. Zero-weight rows are dropped.
 */
export function computeWeights(input: SplitInput): Weight[] {
  const { scenes, curatorBps, hostBps } = input;
  if (curatorBps < 0 || hostBps < 0 || curatorBps + hostBps > WEIGHT_TOTAL)
    throw new Error("curator+host shares exceed 10000");
  if (scenes.length === 0) throw new Error("episode has no scenes");
  const pool = WEIGHT_TOTAL - curatorBps - hostBps;
  const bedBps = input.audioBed ? (input.audioBed.poolBps ?? DEFAULT_AUDIO_BED_BPS) : 0;
  if (bedBps < 0 || bedBps > WEIGHT_TOTAL) throw new Error("audio bed bps out of range");
  const bed = Math.floor((pool * bedBps) / WEIGHT_TOTAL);
  const perCreatorPool = pool - bed;

  const order: string[] = [];
  const msBy = new Map<string, number>();
  for (const s of scenes) {
    const d = ms(s.outSec) - ms(s.inSec);
    if (d <= 0) throw new Error("scene trim out must be after in");
    if (!msBy.has(s.payee)) order.push(s.payee);
    msBy.set(s.payee, (msBy.get(s.payee) ?? 0) + d);
  }
  const shares =
    perCreatorPool > 0
      ? apportion(
          order.map((p) => msBy.get(p) ?? 0),
          perCreatorPool,
        )
      : order.map(() => 0);

  const out: Weight[] = order.map((pubkey, i) => ({
    pubkey,
    role: "creator",
    weight: shares[i] ?? 0,
  }));
  if (input.audioBed && bed > 0)
    out.push({ pubkey: input.audioBed.payee, role: "audio", weight: bed });
  out.push({ pubkey: input.curator, role: "curator", weight: curatorBps });
  out.push({ pubkey: input.host, role: "host", weight: hostBps });
  return out.filter((w) => w.weight > 0);
}

/** sats each recipient gets for a payment of `sats` (integer, remainder to largest shares) */
export function payoutSats(weights: Weight[], sats: number): number[] {
  return apportion(
    weights.map((w) => w.weight),
    sats,
  );
}
