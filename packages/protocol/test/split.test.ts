import { describe, expect, test } from "bun:test";
import { apportion, computeWeights, payoutSats, planPayout, WEIGHT_TOTAL } from "../src";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const CUR = "d".repeat(64);
const HOST = "e".repeat(64);

describe("computeWeights", () => {
  test("PRD worked example: A 62s, B 38s, 70/20/10 -> 4340/2660/2000/1000", () => {
    const w = computeWeights({
      scenes: [
        { payee: A, inSec: 0, outSec: 62 },
        { payee: B, inSec: 0, outSec: 38 },
      ],
      curatorBps: 2000,
      hostBps: 1000,
      curator: CUR,
      host: HOST,
    });
    expect(w.map((x) => [x.role, x.weight])).toEqual([
      ["creator", 4340],
      ["creator", 2660],
      ["curator", 2000],
      ["host", 1000],
    ]);
    expect(payoutSats(w, 1000)).toEqual([434, 266, 200, 100]);
  });

  test("audio bed takes 10% of the creator pool first", () => {
    const w = computeWeights({
      scenes: [
        { payee: A, inSec: 0, outSec: 50 },
        { payee: B, inSec: 0, outSec: 50 },
      ],
      audioBed: { payee: C },
      curatorBps: 2000,
      hostBps: 1000,
      curator: CUR,
      host: HOST,
    });
    expect(w.find((x) => x.role === "audio")?.weight).toBe(700);
    expect(w.filter((x) => x.role === "creator").map((x) => x.weight)).toEqual([3150, 3150]);
    expect(w.reduce((a, x) => a + x.weight, 0)).toBe(WEIGHT_TOTAL);
  });

  test("founder example: 80/20 of the creator pool with curator+host zero", () => {
    const w = computeWeights({
      scenes: [
        { payee: A, inSec: 0, outSec: 80 },
        { payee: B, inSec: 0, outSec: 20 },
      ],
      curatorBps: 0,
      hostBps: 0,
      curator: CUR,
      host: HOST,
    });
    expect(payoutSats(w, 1000)).toEqual([800, 200]);
  });

  test("same payee across scenes aggregates; trims count, not clip length", () => {
    const w = computeWeights({
      scenes: [
        { payee: A, inSec: 2, outSec: 7 },
        { payee: B, inSec: 0, outSec: 5 },
        { payee: A, inSec: 0, outSec: 5 },
      ],
      curatorBps: 0,
      hostBps: 0,
      curator: CUR,
      host: HOST,
    });
    expect(w.map((x) => [x.pubkey, x.weight])).toEqual([
      [A, 6667],
      [B, 3333],
    ]);
  });

  test("always sums to 10000 for awkward durations", () => {
    for (let n = 1; n <= 40; n++) {
      const scenes = Array.from({ length: n }, (_, i) => ({
        payee: String(i % 7).repeat(64),
        inSec: 0,
        outSec: 3.001 + i * 0.137,
      }));
      const w = computeWeights({
        scenes,
        audioBed: { payee: C, poolBps: 333 },
        curatorBps: 1234,
        hostBps: 567,
        curator: CUR,
        host: HOST,
      });
      expect(w.reduce((a, x) => a + x.weight, 0)).toBe(WEIGHT_TOTAL);
    }
  });

  test("rejects bad input", () => {
    expect(() =>
      computeWeights({ scenes: [], curatorBps: 0, hostBps: 0, curator: CUR, host: HOST }),
    ).toThrow();
    expect(() =>
      computeWeights({
        scenes: [{ payee: A, inSec: 3, outSec: 3 }],
        curatorBps: 0,
        hostBps: 0,
        curator: CUR,
        host: HOST,
      }),
    ).toThrow();
    expect(() =>
      computeWeights({
        scenes: [{ payee: A, inSec: 0, outSec: 1 }],
        curatorBps: 6000,
        hostBps: 5000,
        curator: CUR,
        host: HOST,
      }),
    ).toThrow();
  });
});

describe("apportion", () => {
  test("deterministic, exact, ties by index", () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([1, 1, 1], 100)).toEqual(apportion([1, 1, 1], 100));
    expect(apportion([5, 0, 5], 7)).toEqual([4, 0, 3]);
  });
});

describe("planPayout", () => {
  const w = computeWeights({
    scenes: [
      { payee: A, inSec: 0, outSec: 62 },
      { payee: B, inSec: 0, outSec: 38 },
    ],
    curatorBps: 2000,
    hostBps: 1000,
    curator: CUR,
    host: HOST,
  });
  test("paid + carry + fee == total", () => {
    const p = planPayout(w, 1_000_000, { feeMsats: 1000 });
    const sum = [...p.paid, ...p.carry].reduce((a, x) => a + x.msats, 0);
    expect(sum + 1000).toBe(1_000_000);
  });
  test("dust carries, then pays once it accumulates", () => {
    // 100_000 msats: curator gets 20_000 and host 10_000, both under the 21_000 dust line
    let carry = new Map<string, number>();
    let hostPaidAtRound = 0;
    for (let round = 1; round <= 5 && !hostPaidAtRound; round++) {
      const p = planPayout(w, 100_000, { priorCarry: carry });
      expect(
        p.paid.reduce((a, x) => a + x.msats, 0) +
          p.carry.reduce((a, x) => a + x.msats, 0) -
          [...carry.values()].reduce((a, b) => a + b, 0),
      ).toBe(100_000);
      if (p.paid.some((x) => x.pubkey === HOST)) hostPaidAtRound = round;
      carry = new Map(p.carry.map((c) => [c.pubkey, c.msats]));
    }
    expect(hostPaidAtRound).toBe(3); // 10k, 20k, 30k
  });
  test("one pubkey holding two roles is merged before the dust test", () => {
    const w2 = computeWeights({
      scenes: [{ payee: A, inSec: 0, outSec: 10 }],
      curatorBps: 5000,
      hostBps: 0,
      curator: A,
      host: A,
    });
    expect(planPayout(w2, 100_000).paid).toEqual([{ pubkey: A, msats: 100_000 }]);
  });
});

import { buildPayout, KIND, validatePayout } from "../src";

describe("payout receipt with carried balances", () => {
  const w = computeWeights({
    scenes: [{ payee: A, inSec: 0, outSec: 10 }],
    curatorBps: 0,
    hostBps: 0,
    curator: CUR,
    host: HOST,
  });
  const ev = (over: Partial<Parameters<typeof buildPayout>[0]>) => ({
    ...buildPayout({
      cutId: "a".repeat(64),
      cutCoord: `${KIND.CUT}:${CUR}:s:ep-001`,
      weights: w,
      periodStart: 1,
      periodEnd: 2,
      totalMsats: 100_000,
      paid: [],
      ...over,
    }),
    pubkey: CUR,
  });
  test("balances with prior_carry and without it only when there is none", () => {
    // 100_000 new + 50_000 carried = 150_000 paid out
    const paid = [{ pubkey: A, msats: 150_000, proof: "f".repeat(64), proofType: "ln" as const }];
    expect(validatePayout(ev({ paid, priorCarryMsats: 50_000 })).ok).toBe(true);
    const bad = validatePayout(ev({ paid }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain("paid+carry+fee");
  });
  test("a negative or junk prior_carry is rejected", () => {
    const e = ev({ paid: [{ pubkey: A, msats: 100_000, proof: "f".repeat(64), proofType: "ln" }] });
    e.tags.push(["prior_carry", "-5"]);
    expect(validatePayout(e).errors.join()).toContain("prior_carry");
  });
});
