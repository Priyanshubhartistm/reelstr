import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { buildCut, KIND } from "../packages/protocol/src";

const FIX = join(import.meta.dir, "../packages/protocol/fixtures");
const read = (dir: string) =>
  readdirSync(join(FIX, dir)).map((f) => JSON.parse(readFileSync(join(FIX, dir, f), "utf8")).event);
const py = (events: unknown[]) => {
  const path = join(tmpdir(), `interop-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(events));
  const r = Bun.spawnSync(["python3", join(import.meta.dir, "reader.py"), path]);
  return { code: r.exitCode, out: r.stdout.toString() };
};

describe("independent Python reader (NP-7)", () => {
  test("accepts every valid Cut fixture: signatures verify and the recomputed split matches", () => {
    const cuts = read("valid").filter((e) => e.kind === KIND.CUT);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    const r = py(cuts);
    expect(r.code).toBe(0);
    expect(r.out.match(/^OK /gm)?.length).toBe(cuts.length);
    expect(r.out).toContain("creator");
    expect(r.out).toContain("43.40%");
  });

  test("rejects the fixtures whose split or trims are wrong; ignores faults outside its scope", () => {
    const fixtures = read("invalid").filter((e) => e.kind === KIND.CUT);
    const weights = (e: { tags: string[][] }) =>
      e.tags.filter((t) => t[0] === "zap").map((t) => t[3]);
    // the reader judges pins, trims and the split. Price and series ownership are out of its scope.
    const inScope = fixtures.filter(
      (e) =>
        weights(e).includes("5340") ||
        weights(e).includes("4000") ||
        e.tags.some((t: string[]) => t[0] === "scene" && t[3] === "5"),
    );
    expect(inScope.length).toBe(3);
    for (const e of inScope) {
      const r = py([e]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/FAIL/);
    }
    const outOfScope = fixtures.filter((e) => !inScope.includes(e));
    expect(outOfScope.length).toBeGreaterThan(0);
    for (const e of outOfScope) expect(py([e]).code).toBe(0);
  });

  test("a forged signature and a tampered body are caught", () => {
    const cut = read("valid").find((e) => e.kind === KIND.CUT);
    const forged = { ...cut, sig: "00".repeat(64) };
    expect(py([forged]).out).toContain("bad id or signature");
    const edited = { ...cut, content: "edited after signing" };
    expect(py([edited]).out).toContain("bad id or signature");
  });

  test("agrees with the TypeScript builder on awkward splits (randomised, 60 cuts)", () => {
    const sk = generateSecretKey();
    const cur = getPublicKey(sk);
    const pk = (n: number) => getPublicKey(new Uint8Array(32).fill(n + 1));
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const events = Array.from({ length: 60 }, (_, i) => {
      const scenes = Array.from({ length: 1 + rnd(9) }, (_, k) => {
        const inSec = rnd(3000) / 1000;
        return {
          id: `${i}${k}`.padStart(64, "a"),
          sha256: `${k}${i}`.padStart(64, "b"),
          inSec,
          outSec: inSec + 0.5 + rnd(12000) / 1000,
          payee: pk(rnd(6)),
        };
      });
      const tpl = buildCut({
        curator: cur,
        seriesSlug: "r",
        episode: i + 1,
        title: "t",
        synopsis: "s",
        scenes,
        price: { amount: 10 },
        curatorBps: rnd(4000),
        hostBps: rnd(3000),
        host: pk(7),
        audioBed: rnd(2) ? { sha256: "c".repeat(64), payee: pk(8), poolBps: rnd(3000) } : undefined,
        createdAt: 1_790_000_000 + i,
      });
      return finalizeEvent(tpl, sk);
    });
    const r = py(events);
    expect(r.out).not.toContain("FAIL");
    expect(r.code).toBe(0);
    expect(r.out.match(/^OK /gm)?.length).toBe(60);
  });
});
