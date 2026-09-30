import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { type LnBackend, openLedger } from "@reelstr/keys";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildCut, type CutScene, KIND, validateEvent } from "@reelstr/protocol";
import { cleanup, FakeLightning, startFakeMint, startRelay } from "@reelstr/testkit";
import { buildNutzapInfo, CashuWallet, redeemNutzap } from "@reelstr/wallet";
import { runPayouts } from "../src";

const relay = await startRelay();
const ln = new FakeLightning();
const mint = await startFakeMint({ lightning: ln });
const pool = new RelayPool();
const settle = async (i: string) => {
  try {
    ln.pay(i);
  } catch {}
};
const backend: LnBackend = {
  createInvoice: async (o) => ln.createInvoice(o),
  isPaid: async (h) => ln.isPaid(h),
  payInvoice: async (i) => ({ preimage: ln.pay(i).preimage }),
};

// a mock LNURL-pay server for the host's Lightning address
const lnurl: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  fetch(req): Response {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/.well-known/lnurlp/"))
      return Response.json({
        callback: `http://127.0.0.1:${lnurl.port}/cb`,
        minSendable: 1000,
        maxSendable: 10_000_000_000,
        tag: "payRequest",
      });
    if (u.pathname === "/cb")
      return Response.json({
        pr: ln.createInvoice({ sats: Number(u.searchParams.get("amount")) / 1000 }).invoice,
      });
    return new Response("nope", { status: 404 });
  },
});
afterAll(() => {
  lnurl.stop(true);
  mint.stop();
  pool.close([relay.url]);
  cleanup();
});

const T = Math.floor(Date.now() / 1000);
async function person(opts: { nutzap?: boolean; lud16?: string } = {}) {
  const s = LocalSigner.generate();
  const pub = await s.getPublicKey();
  const lockPriv = bytesToHex(randomBytes(32));
  const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
  if (opts.nutzap)
    await pool.publish(
      await s.signEvent(buildNutzapInfo({ p2pk: lockPub, mints: [mint.url], relays: [relay.url] })),
      [relay.url],
    );
  if (opts.lud16)
    await pool.publish(
      await s.signEvent({
        kind: 0,
        created_at: T,
        tags: [],
        content: JSON.stringify({ lud16: opts.lud16 }),
      }),
      [relay.url],
    );
  return { s, pub, lockPriv };
}

async function world() {
  const [A, B, HOST, CUR] = [
    await person({ nutzap: true }),
    await person({ nutzap: true }),
    await person({ lud16: "host@ln.test" }),
    await person(),
  ];
  const scenes: CutScene[] = [
    ...[0, 1, 2, 3].map((i) => ({
      id: bytesToHex(randomBytes(32)),
      sha256: bytesToHex(randomBytes(32)),
      inSec: 0,
      outSec: 15,
      payee: A.pub,
      i,
    })),
    {
      id: bytesToHex(randomBytes(32)),
      sha256: bytesToHex(randomBytes(32)),
      inSec: 0,
      outSec: 2,
      payee: A.pub,
    },
    ...[0, 1].map(() => ({
      id: bytesToHex(randomBytes(32)),
      sha256: bytesToHex(randomBytes(32)),
      inSec: 0,
      outSec: 15,
      payee: B.pub,
    })),
    {
      id: bytesToHex(randomBytes(32)),
      sha256: bytesToHex(randomBytes(32)),
      inSec: 0,
      outSec: 8,
      payee: B.pub,
    },
  ];
  const cutTpl = buildCut({
    curator: CUR.pub,
    seriesSlug: "v",
    episode: 1,
    title: "t",
    synopsis: "s",
    scenes,
    price: { amount: 1000 },
    curatorBps: 2000,
    hostBps: 1000,
    host: HOST.pub,
    createdAt: T,
  });
  const cut = await CUR.s.signEvent(cutTpl);
  await pool.publish(cut, [relay.url]);
  const ledger = openLedger();
  const svc = LocalSigner.generate();
  const wallets = new Map<string, CashuWallet>();
  const walletFor = async (m: string) => {
    let w = wallets.get(m);
    if (!w) {
      w = await CashuWallet.open(m, ledger.proofStore(m));
      wallets.set(m, w);
    }
    return w;
  };
  await (await walletFor(mint.url)).topUp(5000, settle);
  const opts = {
    acknowledgeCustody: true,
    ledger,
    pool,
    relays: [relay.url],
    identity: svc,
    mints: [mint.url],
    walletFor,
    ln: backend,
    lnurl: {
      urlFor: (l: string) => `http://127.0.0.1:${lnurl.port}/.well-known/lnurlp/${l.split("@")[0]}`,
    },
  };
  const receive = (n: number, ref: string) =>
    ledger.addReceipt({
      cut_key: `${CUR.pub}/v:ep-001`,
      cut_event_id: cut.id,
      msats: n * 1000,
      source: "nutzap",
      ref,
    });
  return { A, B, HOST, CUR, cut, ledger, opts, receive, walletFor };
}

describe("split service (BE-7)", () => {
  test("refuses to run without the custody acknowledgement", async () => {
    const w = await world();
    await expect(runPayouts({ ...w.opts, acknowledgeCustody: false })).rejects.toThrow(/custodial/);
  }, 60_000);

  test("worked example: nutzaps to creators, Lightning address to host, curator carried; receipt balances and validates", async () => {
    const w = await world();
    for (const i of [1, 2, 3]) w.receive(1000, `r${i}`); // three unlocks of 1000 sats = 3,000,000 msats
    const rep = await runPayouts(w.opts);
    expect(rep.skipped).toEqual([]);
    const b = rep.batches[0];
    expect(b?.totalMsats).toBe(3_000_000);
    const by = new Map(b?.paid.map((p) => [p.pubkey, p]));
    // weights 4340 / 2660 / 2000 / 1000 of 3,000,000 msats
    expect(by.get(w.A.pub)).toMatchObject({ msats: 1_302_000, proofType: "nutzap" });
    expect(by.get(w.B.pub)).toMatchObject({ msats: 798_000, proofType: "nutzap" });
    expect(by.get(w.HOST.pub)).toMatchObject({ msats: 300_000, proofType: "ln" });
    expect(b?.carried).toMatchObject([{ pubkey: w.CUR.pub, msats: 600_000 }]);
    expect(b?.carried[0]?.why).toMatch(/no payout rail/);

    // the recipients really got the money: redeem the nutzaps from the relay with their lock keys
    for (const [who, sats] of [
      [w.A, 1302],
      [w.B, 798],
    ] as const) {
      const zaps = await pool.query([relay.url], { kinds: [KIND.NUTZAP], "#p": [who.pub] });
      expect(zaps.length).toBe(1);
      expect(
        await redeemNutzap(zaps[0] as never, await CashuWallet.open(mint.url), who.lockPriv),
      ).toBe(sats);
    }
    expect(ln.payments.at(-1)?.sats).toBe(300);

    // the published receipt is valid, self-balancing, and its proofs match what was paid
    const rec = await pool.get([relay.url], { ids: [b?.receiptEventId as string] });
    expect(validateEvent(rec as never, { verifySig: true })).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(rec?.tags.filter((t) => t[0] === "paid").length).toBe(3);
    expect(rec?.tags.find((t) => t[0] === "e")?.[1]).toBe(w.cut.id);

    // idempotent: nothing left to pay, and the receipts are marked done
    expect((await runPayouts(w.opts)).batches).toEqual([]);
    expect(w.ledger.receipts().every((r) => r.paid_out === 1)).toBe(true);
    expect(
      (
        w.ledger.db.query("select msats from carry where pubkey = ?").get(w.CUR.pub) as {
          msats: number;
        }
      ).msats,
    ).toBe(600_000);
  }, 120_000);

  test("carried balances fold into the next batch and the receipt still validates (prior_carry)", async () => {
    const w = await world();
    w.receive(100, "a"); // 100 sats: host share 10 sats is below the 21-sat dust line
    const first = await runPayouts(w.opts);
    expect(first.batches[0]?.paid.some((p) => p.pubkey === w.HOST.pub)).toBe(false);
    expect(first.batches[0]?.carried.find((c) => c.pubkey === w.HOST.pub)?.msats).toBe(10_000);
    w.receive(100, "b");
    w.receive(100, "c");
    const second = await runPayouts(w.opts);
    const host = second.batches[0]?.paid.find((p) => p.pubkey === w.HOST.pub);
    expect(host?.msats).toBe(30_000); // 10 carried + 20 new
    expect(second.batches[0]?.priorCarryMsats).toBeGreaterThan(0);
    const rec = await pool.get([relay.url], { ids: [second.batches[0]?.receiptEventId as string] });
    expect(validateEvent(rec as never, { verifySig: true }).ok).toBe(true);
    expect(rec?.tags.some((t) => t[0] === "prior_carry")).toBe(true);
  }, 120_000);

  test("a missing Cut, or receipts left reserved by a crash, are reported and never paid blindly", async () => {
    const w = await world();
    w.ledger.addReceipt({
      cut_key: "x/y",
      cut_event_id: "9".repeat(64),
      msats: 5_000_000,
      source: "ln",
      ref: "ghost",
    });
    w.receive(500, "real");
    w.ledger.db.query("update receipts set paid_out = 2 where ref = 'real'").run();
    const rep = await runPayouts(w.opts);
    expect(rep.skipped).toMatchObject([
      { cutEventId: "9".repeat(64), reason: expect.stringContaining("not found") },
    ]);
    expect(rep.stuck).toBe(1);
    expect(rep.batches).toEqual([]);
    expect(w.ledger.receipts().find((r) => r.ref === "real")?.paid_out).toBe(2);
  }, 60_000);

  test("a recipient with no working rail is carried, not lost", async () => {
    const w = await world();
    w.receive(1000, "only");
    const rep = await runPayouts({ ...w.opts, ln: undefined, lnurl: undefined });
    const carried = new Map(rep.batches[0]?.carried.map((c) => [c.pubkey, c]));
    expect(carried.get(w.HOST.pub)?.msats).toBe(100_000);
    const total = [...(rep.batches[0]?.paid ?? []), ...(rep.batches[0]?.carried ?? [])].reduce(
      (a, x) => a + x.msats,
      0,
    );
    expect(total).toBe(1_000_000);
  }, 60_000);
});
