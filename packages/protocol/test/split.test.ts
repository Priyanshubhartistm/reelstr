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

import {
  buildRating,
  buildReport,
  buildVerification,
  NS_RATING,
  parseRating,
  parseVerification,
  validateEvent as validate,
} from "../src";

describe("labels: ratings, reports, verifications", () => {
  const cutId = "a".repeat(64);
  const cutCoord = `31811:${"b".repeat(64)}:s:ep-001`;
  const signed = (t: { kind: number; created_at: number; tags: string[][]; content: string }) => ({
    ...t,
    pubkey: "c".repeat(64),
    id: "d".repeat(64),
    sig: "e".repeat(128),
  });
  test("a rating round trips and is validated", () => {
    const e = signed(buildRating({ stars: 4, cutId, cutCoord, review: "tight pacing" }));
    expect(parseRating(e)).toMatchObject({ stars: 4, cutId, review: "tight pacing" });
    expect(validate(e).ok).toBe(true);
    expect(() => buildRating({ stars: 6, cutId, cutCoord })).toThrow();
    expect(() => buildRating({ stars: 2.5, cutId, cutCoord })).toThrow();
    const bad = signed(buildRating({ stars: 3, cutId, cutCoord }));
    bad.tags = bad.tags.map((t) => (t[0] === "l" ? ["l", "9", NS_RATING] : t));
    expect(validate(bad).errors.join()).toContain("1 to 5");
    const long = signed(buildRating({ stars: 3, cutId, cutCoord, review: "x".repeat(2001) }));
    expect(validate(long).ok).toBe(false);
  });
  test("a report needs a known reason; a verification needs a verdict and hash", () => {
    expect(
      validate(
        signed(buildReport({ eventId: cutId, authorPubkey: "b".repeat(64), reason: "spam" })),
      ).ok,
    ).toBe(true);
    expect(() =>
      buildReport({ eventId: cutId, authorPubkey: "b".repeat(64), reason: "rude" as never }),
    ).toThrow();
    const v = signed(
      buildVerification({
        sceneId: cutId,
        sceneSha256: "f".repeat(64),
        verdict: "verified",
        similarity: 0.9876,
        exact: false,
        engine: "wan-2.2",
      }),
    );
    expect(validate(v).ok).toBe(true);
    expect(parseVerification(v)).toMatchObject({
      verdict: "verified",
      similarity: 0.9876,
      exact: false,
      engine: "wan-2.2",
    });
    const noHash = { ...v, tags: v.tags.filter((t) => t[0] !== "x") };
    expect(validate(noHash).errors.join()).toContain("sha256");
    expect(validate({ ...v, tags: v.tags.filter((t) => t[0] !== "L") }).ok).toBe(false); // label of an unknown namespace
  });
});

import {
  buildAgentProfile,
  buildJobRequest,
  buildJobResult,
  parseAgentProfile,
  parseJobRequest,
  validateJobRequest,
  validateJobResult,
} from "../src";

describe("agent jobs (NP-5, NP-6)", () => {
  const agent = "a".repeat(64);
  const requester = "b".repeat(64);
  const signed = (
    t: { kind: number; created_at: number; tags: string[][]; content: string },
    pubkey = requester,
  ) => ({ ...t, pubkey, id: "c".repeat(64), sig: "d".repeat(128) });
  const req = (over = {}) =>
    buildJobRequest({
      agent,
      prompt: "a steel door in rain",
      story: { pubkey: requester, d: "vault" },
      model: "wan-2.2-t2v",
      seed: 7,
      refs: ["e".repeat(64)],
      durationSec: 12,
      bidSats: 500,
      ...over,
    });

  test("a request round trips and validates", () => {
    const e = signed(req());
    expect(validateJobRequest(e)).toMatchObject({ ok: true });
    expect(parseJobRequest(e)).toMatchObject({
      agent,
      requester,
      model: "wan-2.2-t2v",
      seed: "7",
      durationSec: 12,
      bidSats: 500,
      refs: ["e".repeat(64)],
    });
  });
  test("bad requests are rejected with reasons", () => {
    const errs = (over: object) => validateJobRequest(signed(req(over))).errors.join();
    expect(errs({ durationSec: 60 })).toContain("duration");
    expect(errs({ bidSats: -1 })).toContain("bid");
    expect(errs({ prompt: "  " })).toContain("prompt");
    expect(errs({ refs: ["nope"] })).toContain("sha256");
    expect(validateJobRequest(signed(req(), agent)).errors.join()).toContain("commission itself");
    expect(errs({ parentId: "f".repeat(64), license: "All-Rights-Reserved" })).toContain(
      "fork-friendly",
    );
  });
  test("results: success must name its scene; agent profile carries the bot flag", () => {
    const ok = signed(
      buildJobResult({
        jobId: "1".repeat(64),
        requester,
        status: "success",
        content: "{}",
        sceneId: "2".repeat(64),
      }),
      agent,
    );
    expect(validateJobResult(ok).ok).toBe(true);
    expect(
      validateJobResult(
        signed(
          buildJobResult({ jobId: "1".repeat(64), requester, status: "success", content: "{}" }),
          agent,
        ),
      ).errors.join(),
    ).toContain("names its scene");
    expect(
      validateJobResult(
        signed(
          buildJobResult({ jobId: "1".repeat(64), requester, status: "error", content: "no gpu" }),
          agent,
        ),
      ).ok,
    ).toBe(true);
    const prof = buildAgentProfile({
      name: "wan-bot",
      about: "makes scenes",
      models: ["wan-2.2-t2v"],
      priceSats: 400,
    });
    expect(parseAgentProfile(signed(prof, agent))).toEqual({
      name: "wan-bot",
      bot: true,
      models: ["wan-2.2-t2v"],
      priceSats: 400,
    });
    expect(
      parseAgentProfile({ ...signed(prof, agent), content: JSON.stringify({ name: "human" }) }),
    ).toBeNull();
  });
});

import {
  buildCut as buildCutC,
  buildScene as buildSceneC,
  secs,
  validateCut,
  validateScene as validateSceneC,
} from "../src";

describe("canonical seconds", () => {
  test("secs() removes float noise and rounds to milliseconds", () => {
    expect(secs(6.755999999999999)).toBe("6.756");
    expect(secs(0.1 + 0.2)).toBe("0.3");
    expect(secs(12)).toBe("12");
    expect(secs(1.0005)).toBe("1.001");
    expect(() => secs(-1)).toThrow();
    expect(() => secs(Number.NaN)).toThrow();
  });
  test("a Cut built from noisy floats validates and its weights use the rounded values", () => {
    const scenes = [
      {
        id: "1".repeat(64),
        sha256: "a".repeat(64),
        inSec: 1.744,
        outSec: 6.755999999999999,
        payee: A,
      },
      {
        id: "2".repeat(64),
        sha256: "b".repeat(64),
        inSec: 2.376,
        outSec: 3.1319999999999997,
        payee: B,
      },
    ];
    const tpl = buildCutC({
      curator: CUR,
      seriesSlug: "s",
      episode: 1,
      title: "t",
      synopsis: "s",
      scenes,
      price: { amount: 10 },
      curatorBps: 1000,
      hostBps: 500,
      host: HOST,
    });
    const st = tpl.tags.filter((t) => t[0] === "scene");
    expect(st.map((t) => [t[3], t[4]])).toEqual([
      ["1.744", "6.756"],
      ["2.376", "3.132"],
    ]);
    const v = validateCut({ ...tpl, pubkey: CUR });
    expect(v.errors).toEqual([]);
  });
  test("a scene's duration is canonical too", () => {
    const tpl = buildSceneC({
      title: "t",
      content: "c",
      video: { url: "https://x", sha256: "a".repeat(64), duration: 12.000000000000002 },
      story: { pubkey: A, d: "s" },
    });
    expect(tpl.tags.find((t) => t[0] === "imeta")?.includes("duration 12")).toBe(true);
  });
  test("a scene can carry a poster frame in its imeta, and stays valid", () => {
    const tpl = buildSceneC({
      title: "t",
      content: "c",
      video: {
        url: "https://x/v.mp4",
        sha256: "a".repeat(64),
        duration: 12,
        thumbnail: "https://x/p.jpg",
      },
      story: { pubkey: A, d: "s" },
    });
    expect(tpl.tags.find((t) => t[0] === "imeta")?.includes("image https://x/p.jpg")).toBe(true);
    expect(validateSceneC({ ...tpl, pubkey: A, id: "0".repeat(64) }).errors).toEqual([]);
  });
});

import { parseCut as parseCutC } from "../src";

describe("caption tags on a Cut", () => {
  const base = {
    curator: CUR,
    seriesSlug: "s",
    episode: 1,
    title: "t",
    synopsis: "s",
    scenes: [{ id: "1".repeat(64), sha256: "a".repeat(64), inSec: 0, outSec: 70, payee: A }],
    price: { amount: 5 },
    curatorBps: 0,
    hostBps: 0,
    host: HOST,
  };
  test("round trips, validates, and rejects bad urls and language tags", () => {
    const tpl = buildCutC({
      ...base,
      captions: [
        { url: "https://b.example/c.vtt", lang: "en", sha256: "c".repeat(64) },
        { url: "https://b.example/pt.vtt", lang: "pt-BR" },
      ],
    });
    const ev = { ...tpl, pubkey: CUR };
    expect(validateCut(ev).errors).toEqual([]);
    expect(parseCutC(ev).captions).toEqual([
      { url: "https://b.example/c.vtt", lang: "en", sha256: "c".repeat(64) },
      { url: "https://b.example/pt.vtt", lang: "pt-BR", sha256: undefined },
    ]);
    for (const [bad, msg] of [
      [{ url: "javascript:alert(1)", lang: "en" }, "http(s)"],
      [{ url: "https://x/y.vtt", lang: "English" }, "BCP-47"],
      [{ url: "https://x/y.vtt", lang: "en", sha256: "zz" }, "sha256"],
    ] as const) {
      const e2 = { ...buildCutC({ ...base, captions: [bad] }), pubkey: CUR };
      expect(validateCut(e2).errors.join()).toContain(msg);
    }
  });
});
