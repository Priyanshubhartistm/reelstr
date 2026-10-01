import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RelayPool } from "@reelstr/nostr";
import {
  buildCut,
  buildRating,
  buildReport,
  buildScene,
  buildStory,
  buildVerification,
  type CutScene,
  coordinate,
  cutD,
  KIND,
} from "@reelstr/protocol";
import { cleanup, startRelay } from "@reelstr/testkit";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  credits,
  type Ev,
  earnings,
  type Indexer,
  inbox,
  rankInbox,
  ratingSummary,
  reportCounts,
  reviews,
  storyTree,
  verifications,
} from "../src";
import { openIx } from "./open";

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
    const ix = await openIx();
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
    const ix = await openIx();
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
    const ix = await openIx();
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
    const ix = await openIx();
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
    const ix = await openIx();
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
      const ix = await openIx();
      for (const e of order) await ix.ingest(e);
      const rows = await ix.db.query<{ title: string }>("select title from cuts");
      expect(rows.map((r) => r.title)).toEqual(["new"]);
      expect((await ix.db.query("select count(*) as n from cut_scenes"))[0]).toEqual({ n: 1 });
      await ix.close();
    }
  }, 60_000);

  test("rebuild from `events` reproduces every derived table exactly (BE-4)", async () => {
    const ix = await openIx();
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
    const ix = await openIx();
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
    const one = await openIx();
    await one.follow([relay.url]);
    const snap1 = await snapshot(one);
    expect(one.counts.stored).toBe(load("valid").length);
    const two = await openIx();
    await two.follow([relay.url]);
    expect(await snapshot(two)).toBe(snap1);
    expect(cutD("the-vault", 3)).toBe("the-vault:ep-003");
    await one.close();
    await two.close();
    pool.close([relay.url]);
  }, 60_000);
});

describe("labels in the index (FE-11, FE-13, Source Verified)", () => {
  const T2 = 1_790_100_000;
  test("ratings: one per rater, newest wins, average and count; other apps' labels are ignored", async () => {
    const ix = await openIx();
    const cutId = "a".repeat(64);
    const cutCoord = `31811:${"b".repeat(64)}:s:ep-001`;
    const [u1, u2, u3] = [sk(), sk(), sk()];
    const rate = (key: Uint8Array, stars: number, at: number, review = "") =>
      finalizeEvent(buildRating({ stars, cutId, cutCoord, review, createdAt: at }), key) as Ev;
    for (const e of [
      rate(u1, 2, T2),
      rate(u1, 5, T2 + 10, "changed my mind"),
      rate(u2, 4, T2),
      rate(u3, 3, T2),
    ])
      await ix.ingest(e);
    await ix.ingest(rate(u1, 1, T2 - 100)); // an older rating from u1 arriving late must not win
    const [s] = await ratingSummary(ix.db, [cutId]);
    expect(s).toEqual({ cut_id: cutId, count: 3, average: 4 });
    expect((await reviews(ix.db, cutId)).length).toBe(3);
    expect(
      ((await reviews(ix.db, cutId)) as { review: string }[]).some(
        (r) => r.review === "changed my mind",
      ),
    ).toBe(true);
    const foreign = finalizeEvent(
      {
        kind: 1985,
        created_at: T2,
        tags: [
          ["L", "ugc"],
          ["l", "funny", "ugc"],
          ["e", cutId],
        ],
        content: "",
      },
      u1,
    );
    expect((await ix.ingest(foreign as Ev)).result).not.toBe("stored");
    const first = rate(u2, 4, T2);
    expect((await ix.ingest(first)).result).toBe("duplicate");
    await ix.close();
  }, 60_000);

  test("reports count distinct reporters; verifications can be filtered to trusted verifiers", async () => {
    const ix = await openIx();
    const target = "c".repeat(64);
    const author = "d".repeat(64);
    const [r1, r2, v1, v2] = [sk(), sk(), sk(), sk()];
    for (const k of [r1, r1, r2])
      await ix.ingest(
        finalizeEvent(
          buildReport({
            eventId: target,
            authorPubkey: author,
            reason: "spam",
            createdAt: T2 + Math.floor(Math.random() * 1000),
          }),
          k,
        ) as Ev,
      );
    expect(await reportCounts(ix.db, [target, "e".repeat(64)])).toEqual({ [target]: 2 });
    const scene = "f".repeat(64);
    await ix.ingest(
      finalizeEvent(
        buildVerification({
          sceneId: scene,
          sceneSha256: "1".repeat(64),
          verdict: "verified",
          similarity: 0.99,
          exact: false,
          engine: "wan-2.2",
          createdAt: T2,
        }),
        v1,
      ) as Ev,
    );
    await ix.ingest(
      finalizeEvent(
        buildVerification({
          sceneId: scene,
          sceneSha256: "1".repeat(64),
          verdict: "mismatch",
          similarity: 0.2,
          exact: false,
          engine: "wan-2.2",
          createdAt: T2,
        }),
        v2,
      ) as Ev,
    );
    expect((await verifications(ix.db, scene)).length).toBe(2);
    const only = (await verifications(ix.db, scene, [getPublicKey(v1)])) as { verdict: string }[];
    expect(only.map((x) => x.verdict)).toEqual(["verified"]);
    await ix.close();
  }, 60_000);
});

describe("live subscription covers every indexed kind", () => {
  test("ratings, reports and verifications published to a relay reach a running indexer", async () => {
    const relay = await startRelay();
    const pool = new RelayPool();
    const ix = await openIx();
    await ix.follow([relay.url]); // subscribed before anything is published
    const [a, b, c] = [sk(), sk(), sk()];
    const cutId = "9".repeat(64);
    const now = Math.floor(Date.now() / 1000);
    await pool.publish(
      finalizeEvent(
        buildRating({
          stars: 5,
          cutId,
          cutCoord: `31811:${"8".repeat(64)}:s:ep-001`,
          createdAt: now,
        }),
        a,
      ),
      [relay.url],
    );
    await pool.publish(
      finalizeEvent(
        buildReport({
          eventId: cutId,
          authorPubkey: "8".repeat(64),
          reason: "spam",
          createdAt: now,
        }),
        b,
      ),
      [relay.url],
    );
    await pool.publish(
      finalizeEvent(
        buildVerification({
          sceneId: "7".repeat(64),
          sceneSha256: "6".repeat(64),
          verdict: "verified",
          engine: "x",
          createdAt: now,
        }),
        c,
      ),
      [relay.url],
    );
    for (let i = 0; i < 60 && ix.counts.stored < 3; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(ix.counts.stored).toBe(3);
    expect((await ratingSummary(ix.db, [cutId]))[0]).toMatchObject({ count: 1, average: 5 });
    expect(await reportCounts(ix.db, [cutId])).toEqual({ [cutId]: 1 });
    expect((await verifications(ix.db, "7".repeat(64))).length).toBe(1);
    await ix.close();
    pool.close([relay.url]);
  }, 60_000);
});

describe("events with old timestamps are still indexed (regression: since:now dropped them)", () => {
  test("a clock-skewed or backfilled event published after the indexer started is indexed", async () => {
    const relay = await startRelay();
    const pool = new RelayPool();
    const ix = await openIx();
    await ix.follow([relay.url]);
    const author = sk();
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    const story = finalizeEvent(
      buildStory({ d: "old", title: "Old", logline: "l", createdAt: old }),
      author,
    );
    await pool.publish(story, [relay.url]);
    for (let i = 0; i < 60 && ix.counts.stored < 1; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(ix.counts.stored).toBe(1);
    expect((await ix.db.query("select title from stories")).length).toBe(1);
    await ix.close();
    pool.close([relay.url]);
  }, 60_000);
});
