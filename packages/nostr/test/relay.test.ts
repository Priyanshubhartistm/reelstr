import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScene, KIND, validateEvent } from "@reelstr/protocol";
import { finalizeEvent } from "nostr-tools/pure";
import { LocalSigner, RelayPool, withPow } from "../src";

/** Ask the OS for a free port rather than guessing a range (testkit can't be imported here: it depends on this package). */
const freePort = (): number => {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port as number;
  s.stop(true);
  return port;
};

const RELAY_DIR = join(import.meta.dir, "../../../services/relay");
const BIN = join(RELAY_DIR, "bin/relay");
const FIX = join(import.meta.dir, "../../protocol/fixtures/valid");
const fixture = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).event;

const procs: Bun.Subprocess[] = [];
const dirs: string[] = [];

async function startRelay(port: number, powBits: number) {
  const db = mkdtempSync(join(tmpdir(), "reelstr-relay-"));
  dirs.push(db);
  procs.push(
    Bun.spawn([BIN], {
      env: { ...process.env, PORT: String(port), DB_PATH: db, POW_BITS: String(powBits) },
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}`, {
        headers: { Accept: "application/nostr+json" },
      });
      if (r.ok) return `ws://127.0.0.1:${port}`;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("relay did not start");
}

const P = freePort();
let open: string;
let gated: string;
const pool = new RelayPool();

beforeAll(async () => {
  const b = Bun.spawnSync(["go", "build", "-o", "bin/relay", "."], { cwd: RELAY_DIR });
  if (b.exitCode !== 0) throw new Error(`relay build failed: ${b.stderr.toString()}`);
  open = await startRelay(P, 0);
  gated = await startRelay(freePort(), 8);
}, 120_000);

afterAll(() => {
  for (const p of procs) p.kill();
  pool.close([open, gated]);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("reference relay (NP-3)", () => {
  test("accepts every Reelstr kind and returns it, still valid", async () => {
    for (const n of ["story", "scene-root", "cut", "series", "payout"]) {
      const ev = fixture(n);
      const rep = await pool.publish(ev, [open]);
      expect(rep.ok).toEqual([open]);
      const got = await pool.get([open], { ids: [ev.id] });
      expect(got?.id).toBe(ev.id);
      expect(validateEvent(got as never, { verifySig: true }).ok).toBe(true);
    }
    const scenes = await pool.query([open], { kinds: [KIND.SCENE], "#t": ["reelstr"] });
    expect(scenes.length).toBe(1);
  });

  test("rejects non-Reelstr kinds", async () => {
    const s = LocalSigner.generate();
    const note = await s.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hi",
    });
    await expect(pool.publish(note, [open])).rejects.toThrow(/blocked/);
  });

  test("PoW floor applies to scenes only", async () => {
    const s = LocalSigner.generate();
    const pk = await s.getPublicKey();
    const tpl = buildScene({
      title: "pow",
      content: "p",
      video: { url: "https://x/y.mp4", sha256: "a".repeat(64), duration: 12 },
      story: { pubkey: pk, d: "s" },
    });
    await expect(pool.publish(await s.signEvent(tpl), [gated])).rejects.toThrow(/pow/);
    const mined = await s.signEvent(await withPow(tpl, 8, pk));
    expect((await pool.publish(mined, [gated])).ok).toEqual([gated]);
    // a Story is not gated
    expect((await pool.publish(fixture("story"), [gated])).ok).toEqual([gated]);
  });

  test("minAcks across relays: one accept is not enough when two are required", async () => {
    const s = LocalSigner.generate();
    const pk = await s.getPublicKey();
    const tpl = buildScene({
      title: "two",
      content: "p",
      video: { url: "https://x/y.mp4", sha256: "b".repeat(64), duration: 12 },
      story: { pubkey: pk, d: "s" },
    });
    const ev = await s.signEvent(tpl); // passes `open`, fails `gated` (no PoW)
    await expect(pool.publish(ev, [open, gated], 2)).rejects.toThrow(/1\/2/);
    const rep = await pool.publish(ev, [open, gated], 1);
    expect(rep.ok).toEqual([open]);
    expect(rep.failed[0]?.relay).toBe(gated);
  });
});

describe("signers (FE-1)", () => {
  test("NIP-44: two local signers read each other's messages, a third cannot", async () => {
    const a = LocalSigner.generate();
    const b = LocalSigner.generate();
    const c = LocalSigner.generate();
    const ct = await a.nip44Encrypt(await b.getPublicKey(), "secret proofs");
    expect(await b.nip44Decrypt(await a.getPublicKey(), ct)).toBe("secret proofs");
    await expect(c.nip44Decrypt(await a.getPublicKey(), ct)).rejects.toThrow();
    // a wallet encrypts to itself
    const self = await a.getPublicKey();
    expect(await a.nip44Decrypt(self, await a.nip44Encrypt(self, "me"))).toBe("me");
  });

  test("local key signs a valid event and backup round-trips", async () => {
    const a = LocalSigner.generate();
    const b = LocalSigner.fromNsec(a.backup());
    expect(await b.getPublicKey()).toBe(await a.getPublicKey());
    const ev = await a.signEvent({ kind: KIND.STORY, created_at: 1, tags: [], content: "" });
    expect(ev.pubkey).toBe(await a.getPublicKey());
    expect(
      finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "" }, new Uint8Array(32).fill(1))
        .id,
    ).toBeTruthy();
  });
});

describe("created_at limits advertised and enforced", () => {
  test("NIP-11 states the window; events inside it (even old) are accepted, absurd ones refused", async () => {
    const info = (await (
      await fetch(open.replace("ws", "http"), { headers: { Accept: "application/nostr+json" } })
    ).json()) as {
      limitation: { created_at_lower_limit: number; created_at_upper_limit: number };
    };
    expect(info.limitation.created_at_lower_limit).toBe(10 * 365 * 24 * 3600);
    expect(info.limitation.created_at_upper_limit).toBe(3600);
    const s = LocalSigner.generate();
    const now = Math.floor(Date.now() / 1000);
    const story = (at: number) =>
      s.signEvent({
        kind: KIND.STORY,
        created_at: at,
        tags: [
          ["d", `t${at}`],
          ["title", "t"],
          ["license", "CC0-1.0"],
          ["t", "reelstr"],
        ],
        content: "l",
      });
    expect((await pool.publish(await story(now - 5 * 86400), [open])).ok).toEqual([open]); // backfilled
    expect((await pool.publish(await story(now + 600), [open])).ok).toEqual([open]); // slightly fast clock
    await expect(pool.publish(await story(now + 7200), [open])).rejects.toThrow(
      /future|too|timestamp/i,
    );
    await expect(pool.publish(await story(now - 11 * 365 * 86400), [open])).rejects.toThrow(
      /past|old|too|timestamp/i,
    );
  });
});

describe("publishing survives a dead connection", () => {
  test("a relay restart (or a dropped idle socket) is recovered with one reconnect; a refusal is not retried", async () => {
    const port = freePort();
    const startOn = async () => {
      const db = mkdtempSync(join(tmpdir(), "reelstr-relay-"));
      dirs.push(db);
      const p = Bun.spawn([BIN], {
        env: { ...process.env, PORT: String(port), DB_PATH: db, POW_BITS: "0" },
        stdout: "ignore",
        stderr: "ignore",
      });
      procs.push(p);
      for (let i = 0; i < 50; i++) {
        try {
          if (
            (
              await fetch(`http://127.0.0.1:${port}`, {
                headers: { Accept: "application/nostr+json" },
              })
            ).ok
          )
            return p;
        } catch {}
        await Bun.sleep(100);
      }
      throw new Error("relay did not start");
    };
    const url = `ws://127.0.0.1:${port}`;
    const first = await startOn();
    const p2 = new RelayPool();
    const s = LocalSigner.generate();
    const mk = (n: string) =>
      s.signEvent({
        kind: KIND.STORY,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", n],
          ["title", n],
          ["license", "CC0-1.0"],
          ["t", "reelstr"],
        ],
        content: "l",
      });
    expect((await p2.publish(await mk("one"), [url])).ok).toEqual([url]);
    first.kill(); // the pooled socket is now dead
    await first.exited;
    await startOn(); // same address, new process
    const rep = await p2.publish(await mk("two"), [url]);
    expect(rep.ok).toEqual([url]);
    expect(
      (await p2.query([url], { kinds: [KIND.STORY] })).map(
        (e) => e.tags.find((t) => t[0] === "d")?.[1],
      ),
    ).toEqual(["two"]);
    // a refusal comes straight back: one attempt, no reconnect storm
    const t0 = Date.now();
    await expect(
      p2.publish(
        await s.signEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "x",
        }),
        [url],
      ),
    ).rejects.toThrow(/blocked/);
    expect(Date.now() - t0).toBeLessThan(2000);
    p2.close([url]);
  }, 60_000);
});

import { getEventHash } from "nostr-tools/pure";
import { leadingZeroBits } from "../src";

describe("NIP-13 mining", () => {
  test("leadingZeroBits counts like NIP-13 (including partial hex digits)", () => {
    expect(leadingZeroBits("ffff")).toBe(0);
    expect(leadingZeroBits("7fff")).toBe(1);
    expect(leadingZeroBits("0fff")).toBe(4);
    expect(leadingZeroBits("00ff")).toBe(8);
    expect(leadingZeroBits("0001")).toBe(15);
    expect(leadingZeroBits("0000")).toBe(16);
    expect(leadingZeroBits("1000")).toBe(3);
  });

  test("mined events really have the difficulty, replace a stale nonce, and bits <= 0 is a no-op", async () => {
    const pk = await LocalSigner.generate().getPublicKey();
    const tpl = {
      kind: 34236,
      created_at: 1_790_000_000,
      tags: [
        ["t", "reelstr"],
        ["nonce", "5", "99"],
      ],
      content: "x",
    };
    const mined = await withPow(tpl, 12, pk);
    expect(mined.tags.filter((t) => t[0] === "nonce")).toHaveLength(1);
    expect(mined.tags.find((t) => t[0] === "nonce")?.[2]).toBe("12");
    expect(leadingZeroBits(getEventHash({ ...mined, pubkey: pk }))).toBeGreaterThanOrEqual(12);
    expect(await withPow(tpl, 0, pk)).toBe(tpl);
  });

  test("mining yields to the event loop: timers and other work keep running while it searches", async () => {
    const pk = await LocalSigner.generate().getPublicKey();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    const t0 = Date.now();
    // several mines so one lucky nonce cannot make the run trivially short (16 bits ~ 65k hashes each)
    for (let i = 0; i < 6; i++)
      await withPow({ kind: 1, created_at: 1 + i, tags: [], content: `yield ${i}` }, 16, pk);
    const ms = Date.now() - t0;
    clearInterval(timer);
    console.log(`mined 6 x 16 bits in ${ms} ms with ${ticks} timer ticks meanwhile`);
    // a blocking miner lets the 5 ms timer fire ~0 times; a yielding one keeps it running throughout
    expect(ms).toBeGreaterThan(300);
    expect(ticks).toBeGreaterThan(Math.floor(ms / 50));
  }, 60_000);
});
