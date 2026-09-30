import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScene, KIND, validateEvent } from "@reelstr/protocol";
import { finalizeEvent } from "nostr-tools/pure";
import { LocalSigner, RelayPool, withPow } from "../src";

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

const P = 34000 + Math.floor(Math.random() * 1000);
let open: string;
let gated: string;
const pool = new RelayPool();

beforeAll(async () => {
  const b = Bun.spawnSync(["go", "build", "-o", "bin/relay", "."], { cwd: RELAY_DIR });
  if (b.exitCode !== 0) throw new Error(`relay build failed: ${b.stderr.toString()}`);
  open = await startRelay(P, 0);
  gated = await startRelay(P + 1, 8);
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
    const mined = await s.signEvent(withPow(tpl, 8, pk));
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
