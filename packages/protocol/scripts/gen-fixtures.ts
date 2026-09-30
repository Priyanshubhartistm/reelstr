/** Regenerates fixtures/ deterministically (fixed keys and timestamps). Run: bun scripts/gen-fixtures.ts */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import {
  buildCut,
  buildPayout,
  buildScene,
  buildSeries,
  buildStory,
  type CutScene,
  coordinate,
  cutWeights,
  type EventTemplate,
  KIND,
  planPayout,
} from "../src";

const T = 1_790_000_000;
const hash = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));
const sk = (n: number) => new Uint8Array(32).fill(n);
const K = { a: sk(1), b: sk(2), c: sk(3), cur: sk(4), host: sk(5), bot: sk(6) };
const pk = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, getPublicKey(v)])) as Record<
  keyof typeof K,
  string
>;
const sign = (t: EventTemplate, key: Uint8Array) => finalizeEvent(t, key);

const root = join(import.meta.dir, "..", "fixtures");
rmSync(root, { recursive: true, force: true });
for (const d of ["valid", "invalid"]) mkdirSync(join(root, d), { recursive: true });
const out = (dir: string, name: string, event: unknown, expect: string[] = []) =>
  writeFileSync(join(root, dir, `${name}.json`), `${JSON.stringify({ event, expect }, null, 2)}\n`);

const story = sign(
  buildStory({
    d: "vault-heist",
    title: "The Vault",
    logline: "A crew, a door, a clock.",
    style: "neon noir, 9:16",
    cast: [{ name: "Mara", refSha256: hash("mara-ref"), description: "lead" }],
    relays: ["wss://relay.example"],
    createdAt: T,
  }),
  K.a,
);
out("valid", "story", story);

const sceneBase = (n: string, extra: Partial<Parameters<typeof buildScene>[0]> = {}) =>
  buildScene({
    title: n,
    content: `prompt for ${n}`,
    video: { url: `https://blossom.example/${hash(n)}.mp4`, sha256: hash(n), duration: 12.4 },
    story: { pubkey: pk.a, d: "vault-heist" },
    createdAt: T + 1,
    gen: { model: { name: "wan-2.2-t2v", open: true }, seed: 828341, refs: [hash("mara-ref")] },
    ...extra,
  });

const s1 = sign(sceneBase("ep1-door"), K.a);
out("valid", "scene-root", s1);
out("valid", "scene-fork", sign(sceneBase("ep1-door-v2", { parent: { id: s1.id } }), K.b));
out(
  "valid",
  "scene-agent",
  sign(sceneBase("ep1-agent", { commissioner: { pubkey: pk.c } }), K.bot),
);
out(
  "valid",
  "scene-closed-model",
  sign(sceneBase("ep1-kling", { gen: { model: { name: "kling-3", open: false } } }), K.a),
);

const bad = (name: string, t: EventTemplate, key: Uint8Array, expect: string) =>
  out("invalid", name, sign(t, key), [expect]);
const mutate = (t: EventTemplate, f: (tags: string[][]) => string[][]): EventTemplate => ({
  ...t,
  tags: f(t.tags.map((x) => [...x])),
});
const base = sceneBase("bad-base");
bad(
  "scene-no-license",
  mutate(base, (t) => t.filter((x) => x[0] !== "license")),
  K.a,
  "license tag is required",
);
bad(
  "scene-d-mismatch",
  mutate(base, (t) => t.map((x) => (x[0] === "d" ? ["d", hash("other")] : x))),
  K.a,
  "d tag must equal",
);
bad(
  "scene-too-long",
  {
    ...sceneBase("bad-long", {
      video: { url: "https://x/y.mp4", sha256: hash("bad-long"), duration: 25 },
    }),
  },
  K.a,
  "longer than 20s",
);
bad(
  "scene-no-root",
  mutate(base, (t) => t.filter((x) => x[0] !== "a")),
  K.a,
  "missing a tag marked root",
);
bad(
  "scene-bad-gen-flag",
  mutate(base, (t) => t.map((x) => (x[1] === "model" ? ["gen", "model", "wan", "maybe"] : x))),
  K.a,
  "open|closed flag",
);

// Cut: A 62 s (4x15 + 2), B 38 s (2x15 + 8), 70/20/10 -> 4340/2660/2000/1000
const mk = (name: string, who: keyof typeof K, a: number, b: number): CutScene => ({
  id: hash(`ev-${name}`),
  sha256: hash(name),
  inSec: a,
  outSec: b,
  payee: pk[who],
});
const scenes: CutScene[] = [
  ...[1, 2, 3, 4].map((i) => mk(`a${i}`, "a", 0, 15)),
  mk("a5", "a", 0, 2),
  ...[1, 2].map((i) => mk(`b${i}`, "b", 0, 15)),
  mk("b3", "b", 0, 8),
];
const cutParams = {
  curator: pk.cur,
  seriesSlug: "the-vault",
  episode: 3,
  title: "The vault door",
  synopsis: "They reach the door.",
  scenes,
  price: { amount: 50 },
  curatorBps: 2000,
  hostBps: 1000,
  host: pk.host,
  relay: "wss://relay.example",
  createdAt: T + 2,
} as const;
const cut = sign(buildCut(cutParams), K.cur);
out("valid", "cut", cut);
out(
  "valid",
  "cut-audio-bed",
  sign(
    buildCut({ ...cutParams, episode: 4, audioBed: { sha256: hash("score"), payee: pk.c } }),
    K.cur,
  ),
);
const cutT = buildCut(cutParams);
bad(
  "cut-weights-tampered",
  mutate(cutT, (t) =>
    t.map((x) =>
      x[0] === "zap" && x[4] === "creator" && x[1] === pk.a
        ? ["zap", x[1] ?? "", x[2] ?? "", "5340", "creator"]
        : x,
    ),
  ),
  K.cur,
  "zap weights sum to",
);
bad(
  "cut-wrong-split",
  mutate(cutT, (t) => {
    let n = 0;
    return t.map((x) =>
      x[0] === "zap" && x[4] === "creator"
        ? ["zap", x[1] ?? "", x[2] ?? "", n++ === 0 ? "4000" : "3000", "creator"]
        : x,
    );
  }),
  K.cur,
  "differ from recomputed",
);
bad(
  "cut-trim-inverted",
  mutate(cutT, (t) => {
    const i = t.findIndex((x) => x[0] === "scene");
    t[i] = ["scene", t[i]?.[1] ?? "", t[i]?.[2] ?? "", "5", "3", t[i]?.[5] ?? ""];
    return t;
  }),
  K.cur,
  "out must be after in",
);
bad(
  "cut-foreign-series",
  mutate(cutT, (t) =>
    t.map((x) => (x[0] === "a" ? ["a", coordinate(KIND.SERIES, pk.a, "the-vault"), ""] : x)),
  ),
  K.cur,
  "owned by the Cut's curator",
);
bad(
  "cut-no-price",
  mutate(cutT, (t) => t.filter((x) => x[0] !== "price")),
  K.cur,
  "price must be",
);

out(
  "valid",
  "series",
  sign(
    buildSeries({
      curator: pk.cur,
      slug: "the-vault",
      title: "The Vault",
      summary: "A heist in 10 episodes.",
      episodes: [3, 4],
      freeEpisodes: 1,
      createdAt: T + 3,
    }),
    K.cur,
  ),
);
bad(
  "series-bad-free",
  mutate(
    buildSeries({
      curator: pk.cur,
      slug: "the-vault",
      title: "x",
      summary: "s",
      episodes: [3],
      createdAt: T,
    }),
    (t) => t.map((x) => (x[0] === "free" ? ["free", "many"] : x)),
  ),
  K.cur,
  "free must be an integer",
);

const w = cutWeights(cutParams);
const plan = planPayout(w, 1_000_000);
out(
  "valid",
  "payout",
  sign(
    buildPayout({
      cutId: cut.id,
      cutCoord: coordinate(KIND.CUT, pk.cur, "the-vault:ep-003"),
      weights: w,
      periodStart: T,
      periodEnd: T + 86400,
      totalMsats: 1_000_000,
      paid: plan.paid.map((p) => ({
        ...p,
        proof: hash(`proof-${p.pubkey}`),
        proofType: "nutzap" as const,
      })),
      carry: plan.carry,
      createdAt: T + 4,
    }),
    K.host,
  ),
);
bad(
  "payout-unbalanced",
  buildPayout({
    cutId: cut.id,
    cutCoord: coordinate(KIND.CUT, pk.cur, "the-vault:ep-003"),
    weights: w,
    periodStart: T,
    periodEnd: T + 1,
    totalMsats: 1_000_000,
    paid: [{ pubkey: pk.a, msats: 300_000, proof: hash("p"), proofType: "ln" }],
    createdAt: T,
  }),
  K.host,
  "paid+carry+fee",
);
console.log("fixtures written");
