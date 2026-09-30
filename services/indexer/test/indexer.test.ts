import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RelayPool } from "@reelstr/nostr";
import {
  buildCut,
  buildScene,
  buildStory,
  type CutScene,
  coordinate,
  cutD,
  KIND,
} from "@reelstr/protocol";
import { cleanup, startRelay } from "@reelstr/testkit";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { credits, type Ev, earnings, Indexer, inbox, rankInbox, storyTree } from "../src";

afterAll(cleanup);

const FIX = join(import.meta.dir, "../../../packages/protocol/fixtures");
const load = (dir: string) =>
  readdirSync(join(FIX, dir)).map((f) => ({
    f,
    ...(JSON.parse(readFileSync(join(FIX, dir, f), "utf8")) as { event: Ev; expect: string[] }),
  }));

const sk = () => generateSecretKey();
const T = 1_790_000_000;

async function snapshot(ix: Indexer) {
  const out: Record<string, unknown[]> = {};
  for (const [t, order] of [
    ["stories", "coord"],
    ["scenes", "id"],
    ["cuts", "coord"],
    ["cut_scenes", "cut_id, pos"],
    ["cut_weights", "cut_id, pubkey, role"],
    ["series", "coord"],
    ["series_cuts", "series_coord, pos"],
    ["payouts", "id"],
    ["payout_paid", "payout_id, pubkey"],
    ["follows", "pubkey, followed"],
  ] as const)
    out[t] = await ix.db.query(`select * from ${t} order by ${order}`);
  return JSON.stringify(out);
}

describe("ingest", () => {
  test("valid fixtures are stored, invalid ones rejected with reasons, duplicates ignored", async () => {
    const ix = await Indexer.open();
    for (const v of load("valid")) expect((await ix.ingest(v.event)).result).toBe("stored");
    for (const v of load("invalid")) {
      const r = await ix.ingest(v.event);
      expect(r.result).toBe("rejected");
      expect((r.reasons ?? []).join(" ")).toContain(v.expect[0] as string);
    }
    expect((await ix.ingest(load("valid")[0]?.event as Ev)).result).toBe("duplicate");
    expect(ix.counts.rejected).toBe(load("invalid").length);
    const rej = await ix.db.query("select count(*) as n from rejected");
    expect(Number((rej[0] as { n: string }).n)).toBe(load("invalid").length);
    // nothing from a rejected event reached the graph
    expect((await ix.db.query("select 1 from cuts where coord like '%ep-003'")).length).toBe(1);
    await ix.close();
  }, 60_000);

  test("a tampered event and a forged follow list are rejected", async () => {
    const ix = await Indexer.open();
    const v = load("valid").find((x) => x.f === "story.json")?.event as Ev;
    expect((await ix.ingest({ ...v, content: "evil" })).result).toBe("rejected");
    const k = sk();
    const good = finalizeEvent(
      { kind: 3, created_at: T, tags: [["p", "a".repeat(64)]], content: "" },
      k,
    );
    expect((await ix.ingest(good as Ev)).result).toBe("stored");
    expect(
      (await ix.ingest({ ...good, id: "b".repeat(64), tags: [["p", "c".repeat(64)]] } as Ev))
        .result,
    ).toBe("rejected");
    await ix.close();
  });
});

describe("graph queries", () => {
  async function world() {
    const ix = await Indexer.open();
    const a = sk(),
      b = sk(),
      cur = sk(),
      host = sk();
    const pk = {
      a: getPublicKey(a),
      b: getPublicKey(b),
      cur: getPublicKey(cur),
      host: getPublicKey(host),
    };
    const story = finalizeEvent(buildStory({ d: "s", title: "S", logline: "l", createdAt: T }), a);
    const coord = coordinate(KIND.STORY, pk.a, "s");
    const mk = (n: string, key: Uint8Array, parent?: string, at = T + 1) =>
      finalizeEvent(
        buildScene({
          title: n,
          content: n,
          video: {
            url: `https://x/${n}`,
            sha256: n
              .padEnd(64, "0")
              .slice(0, 64)
              .replace(/[^0-9a-f]/g, "a"),
            duration: 12,
          },
          story: { pubkey: pk.a, d: "s" },
          parent: parent ? { id: parent } : undefined,
          createdAt: at,
        }),
        key,
      );
    const s1 = mk("root1", a);
    const s2 = mk("fork1", b, s1.id, T + 2);
    const s3 = mk("fork2", a, s2.id, T + 3);
    const s4 = mk("lonely", b, undefined, T + 4);
    for (const e of [story, s1, s2, s3, s4]) await ix.ingest(e as Ev);
    return { ix, a, b, cur, host, pk, coord, scenes: { s1, s2, s3, s4 } };
  }

  test("story tree: forks nest under parents, depth is right, `used` marks scenes in a Cut", async () => {
    const w = await world();
    const { s1, s2, s3 } = w.scenes;
    const cs: CutScene[] = [
      { id: s1.id, sha256: "a".repeat(64), inSec: 0, outSec: 12, payee: w.pk.a },
      { id: s3.id, sha256: "b".repeat(64), inSec: 0, outSec: 12, payee: w.pk.a },
    ];
    const cut = finalizeEvent(
      buildCut({
        curator: w.pk.cur,
        seriesSlug: "ser",
        episode: 1,
        title: "E1",
        synopsis: "x",
        scenes: cs,
        price: { amount: 10 },
        curatorBps: 2000,
        hostBps: 1000,
        host: w.pk.host,
        createdAt: T + 5,
      }),
      w.cur,
    );
    await w.ix.ingest(cut as Ev);
    const tree = await storyTree(w.ix.db, w.coord);
    expect(tree.map((n) => [n.depth, n.title])).toEqual([
      [0, "root1"],
      [0, "lonely"],
      [1, "fork1"],
      [2, "fork2"],
    ]);
    expect(tree.find((n) => n.title === "fork1")?.parent_id).toBe(s1.id);
    expect(Object.fromEntries(tree.map((n) => [n.title, n.used]))).toEqual({
      root1: true,
      lonely: false,
      fork1: false,
      fork2: true,
    });
    expect(s2.id).toBeTruthy();
    await w.ix.close();
  }, 60_000);

  test("credits: seconds and shares per recipient, totals exactly 100%", async () => {
    const ix = await Indexer.open();
    for (const v of load("valid")) await ix.ingest(v.event);
    const cut = load("valid").find((x) => x.f === "cut.json")?.event as Ev;
    const c = await credits(ix.db, cut.id);
    expect(c.reduce((a, x) => a + x.percent, 0)).toBeCloseTo(100, 6);
    const creators = c.filter((x) => x.role === "creator");
    expect(creators.map((x) => [x.seconds, x.weight])).toEqual([
      [62, 4340],
      [38, 2660],
    ]);
    expect(c.map((x) => x.role).sort()).toEqual(["creator", "creator", "curator", "host"]);
    await ix.close();
  }, 60_000);

  test("earnings: seconds used, episodes, and sats paid per the payout receipt", async () => {
    const ix = await Indexer.open();
    for (const v of load("valid")) await ix.ingest(v.event);
    const cut = load("valid").find((x) => x.f === "cut.json")?.event as Ev;
    const creatorA = (cut.tags.find((t) => t[0] === "scene") as string[])[5] as string;
    const e = await earnings(ix.db, creatorA);
    // fixtures hold two Cuts (ep 3 and ep 4) using the same 62 s; the receipt only covers ep 3
    expect(e).toEqual({ secondsUsed: 124, episodes: 2, receivedMsats: 434_000 });
    await ix.close();
  }, 60_000);

  test("addressable replacement is order independent: newest Cut wins either way", async () => {
    const cur = sk(),
      host = sk();
    const pk = { cur: getPublicKey(cur), host: getPublicKey(host) };
    const mk = (title: string, at: number) =>
      finalizeEvent(
        buildCut({
          curator: pk.cur,
          seriesSlug: "s",
          episode: 1,
          title,
          synopsis: "x",
          scenes: [
            { id: "c".repeat(64), sha256: "d".repeat(64), inSec: 0, outSec: 70, payee: pk.host },
          ],
          price: { amount: 5 },
          curatorBps: 1000,
          hostBps: 0,
          host: pk.host,
          createdAt: at,
        }),
        cur,
      ) as Ev;
    const v1 = mk("old", T),
      v2 = mk("new", T + 10);
    for (const order of [
      [v1, v2],
      [v2, v1],
    ]) {
      const ix = await Indexer.open();
      for (const e of order) await ix.ingest(e);
      const rows = await ix.db.query<{ title: string }>("select title from cuts");
      expect(rows.map((r) => r.title)).toEqual(["new"]);
      expect((await ix.db.query("select count(*) as n from cut_scenes"))[0]).toEqual({ n: 1 });
      await ix.close();
    }
  }, 60_000);

  test("rebuild from `events` reproduces every derived table exactly (BE-4)", async () => {
    const ix = await Indexer.open();
    for (const v of load("valid")) await ix.ingest(v.event);
    const before = await snapshot(ix);
    expect(before.length).toBeGreaterThan(500);
    await ix.db.exec("delete from cut_scenes; delete from cut_weights; delete from scenes");
    expect(await snapshot(ix)).not.toBe(before);
    const n = await ix.rebuild();
    expect(n).toBe(load("valid").length);
    expect(await snapshot(ix)).toBe(before);
    await ix.close();
  }, 60_000);
});

describe("web of trust (BE-5)", () => {
  // deterministic PRNG so the spam test is reproducible
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
  const hex = (n: number) => n.toString(16).padStart(64, "0");

  test("seeded spam test: 900 unknown spammers + 3 with PoW vs 100 trusted authors -> spam rate < 5%", () => {
    const graph = new Map<string, Set<string>>();
    const curator = hex(1);
    const trusted = Array.from({ length: 100 }, (_, i) => hex(1000 + i));
    graph.set(curator, new Set(trusted.slice(0, 20)));
    for (const [i, t] of trusted.slice(0, 20).entries())
      graph.set(t, new Set(trusted.slice(20 + i * 4, 24 + i * 4)));
    const items = [
      ...trusted.map((a, i) => ({ id: `t${i}`, author: a, created_at: T + i, pow_bits: 0 })),
      ...Array.from({ length: 900 }, (_, i) => ({
        id: `s${i}`,
        author: hex(50_000 + i),
        created_at: T + Math.floor(rnd() * 1000),
        pow_bits: Math.floor(rnd() * 8),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `p${i}`,
        author: hex(90_000 + i),
        created_at: T,
        pow_bits: 20,
      })),
    ];
    const ranked = rankInbox(items, { graph, roots: [curator], zaps: new Map(), minPowBits: 16 });
    const spam = ranked.filter((r) => r.id.startsWith("s") || r.id.startsWith("p")).length;
    expect(spam / ranked.length).toBeLessThan(0.05);
    expect(ranked.filter((r) => r.id.startsWith("s")).length).toBe(0);
    // trusted authors one hop away outrank everyone else
    expect(ranked.slice(0, 20).every((r) => r.hops === 1)).toBe(true);
    expect(ranked.at(-1)?.id.startsWith("p")).toBe(true);
  });

  test("zaps break ties within a hop; scenes already in a Cut are not in the inbox", async () => {
    const ix = await Indexer.open();
    const cur = sk(),
      a = sk(),
      b = sk(),
      z = sk();
    const pk = { cur: getPublicKey(cur), a: getPublicKey(a), b: getPublicKey(b) };
    await ix.ingest(
      finalizeEvent(
        {
          kind: 3,
          created_at: T,
          tags: [
            ["p", pk.a],
            ["p", pk.b],
          ],
          content: "",
        },
        cur,
      ) as Ev,
    );
    const mk = (n: string, key: Uint8Array) =>
      finalizeEvent(
        buildScene({
          title: n,
          content: n,
          video: { url: "https://x", sha256: n.repeat(64).slice(0, 64), duration: 12 },
          story: { pubkey: pk.cur, d: "s" },
          createdAt: T + 1,
        }),
        key,
      ) as Ev;
    const sa = mk("a", a),
      sb = mk("b", b);
    await ix.ingest(sa);
    await ix.ingest(sb);
    const receipt = finalizeEvent(
      {
        kind: 9735,
        created_at: T + 2,
        tags: [
          ["p", pk.b],
          ["description", JSON.stringify({ tags: [["amount", "5000000"]] })],
        ],
        content: "",
      },
      z,
    );
    await ix.ingest(receipt as Ev);
    const list = await inbox(ix.db, { curator: pk.cur });
    expect(list.map((i) => i.id)).toEqual([sb.id, sa.id]);
    await ix.close();
  }, 60_000);
});

describe("follow relays", () => {
  test("a fresh indexer rebuilds the same graph from a relay alone (BE-4)", async () => {
    const relay = await startRelay();
    const pool = new RelayPool();
    for (const v of load("valid")) await pool.publish(v.event, [relay.url]);
    const one = await Indexer.open();
    await one.follow([relay.url]);
    const snap1 = await snapshot(one);
    expect(one.counts.stored).toBe(load("valid").length);
    const two = await Indexer.open();
    await two.follow([relay.url]);
    expect(await snapshot(two)).toBe(snap1);
    expect(cutD("the-vault", 3)).toBe("the-vault:ep-003");
    await one.close();
    await two.close();
    pool.close([relay.url]);
  }, 60_000);
});
