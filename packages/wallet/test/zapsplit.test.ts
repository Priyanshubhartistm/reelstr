import { afterAll, describe, expect, test } from "bun:test";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildCut, validateEvent, verifySignature } from "@reelstr/protocol";
import { cleanup, FakeLightning, startFakeNwc, startRelay } from "@reelstr/testkit";
import { NwcWallet, zapSplit } from "../src";

const relay = await startRelay();
const ln = new FakeLightning();
const pool = new RelayPool();
const received = new Map<string, { sats: number; req: { kind: number; tags: string[][] } }>();

// mock LNURL-pay server with NIP-57 support: validates the zap request before issuing an invoice
const srv: ReturnType<typeof Bun.serve> = Bun.serve({
  port: 0,
  fetch(req): Response {
    const u = new URL(req.url);
    const name = u.pathname.split("/").pop() as string;
    if (u.pathname.startsWith("/.well-known/lnurlp/"))
      return Response.json({
        callback: `http://127.0.0.1:${srv.port}/cb/${name}`,
        minSendable: 1000,
        maxSendable: 1e9,
        allowsNostr: name !== "nozap",
        nostrPubkey: "f".repeat(64),
        tag: "payRequest",
      });
    if (u.pathname.startsWith("/cb/")) {
      const amount = Number(u.searchParams.get("amount"));
      const zr = JSON.parse(u.searchParams.get("nostr") ?? "null");
      if (!zr?.kind || zr.kind !== 9734 || !verifySignature(zr))
        return Response.json({ status: "ERROR", reason: "bad zap request" }, { status: 400 });
      if (Number(zr.tags.find((t: string[]) => t[0] === "amount")?.[1]) !== amount)
        return Response.json({ status: "ERROR", reason: "amount mismatch" }, { status: 400 });
      const { invoice, paymentHash } = ln.createInvoice({ sats: amount / 1000 });
      received.set(name, { sats: amount / 1000, req: zr });
      void paymentHash;
      return Response.json({ pr: invoice });
    }
    return new Response("nope", { status: 404 });
  },
});
afterAll(() => {
  srv.stop(true);
  pool.close([relay.url]);
  cleanup();
});

const T = Math.floor(Date.now() / 1000);
async function recipient(lud16?: string) {
  const s = LocalSigner.generate();
  if (lud16)
    await pool.publish(
      await s.signEvent({ kind: 0, created_at: T, tags: [], content: JSON.stringify({ lud16 }) }),
      [relay.url],
    );
  return { s, pub: await s.getPublicKey() };
}

describe("zap split tips (PY-1)", () => {
  async function scene() {
    const [a, b, cur, host] = [
      await recipient("alice@x.test"),
      await recipient("bob@x.test"),
      await recipient("cara@x.test"),
      await recipient("hank@x.test"),
    ];
    const scenes = [
      { id: "1".repeat(64), sha256: "a".repeat(64), inSec: 0, outSec: 62, payee: a.pub },
      { id: "2".repeat(64), sha256: "b".repeat(64), inSec: 0, outSec: 38, payee: b.pub },
    ];
    const cut = await cur.s.signEvent(
      buildCut({
        curator: cur.pub,
        seriesSlug: "v",
        episode: 1,
        title: "t",
        synopsis: "s",
        scenes,
        price: { amount: 10 },
        curatorBps: 2000,
        hostBps: 1000,
        host: host.pub,
        createdAt: T,
      }),
    );
    const svc = await startFakeNwc({ relay: relay.url, lightning: ln, balanceSats: 5000 });
    const viewer = LocalSigner.generate();
    const opts = {
      cut,
      signer: viewer,
      nwc: NwcWallet.fromUri(svc.uri, 10_000),
      pool,
      relays: [relay.url],
      lnurl: {
        urlFor: (l: string) => `http://127.0.0.1:${srv.port}/.well-known/lnurlp/${l.split("@")[0]}`,
      },
    };
    return { a, b, cur, host, cut, svc, opts };
  }

  test("a 1,000-sat zap reaches every recipient by weight: 434 / 266 / 200 / 100", async () => {
    received.clear();
    const w = await scene();
    expect(validateEvent(w.cut as never).ok).toBe(true);
    const r = await zapSplit({ ...w.opts, sats: 1000, comment: "great episode" });
    expect(r.failed).toEqual([]);
    expect(Object.fromEntries(r.paid.map((p) => [p.pubkey, p.sats]))).toEqual({
      [w.a.pub]: 434,
      [w.b.pub]: 266,
      [w.cur.pub]: 200,
      [w.host.pub]: 100,
    });
    expect(r.paid.reduce((x, p) => x + p.sats, 0)).toBe(1000);
    // the wallet was charged exactly that, and every zap request names the recipient and the Cut
    expect(await w.opts.nwc.getBalanceSats()).toBe(4000);
    const req = received.get("alice")?.req;
    expect(req?.tags.find((t) => t[0] === "p")?.[1]).toBe(w.a.pub);
    expect(req?.tags.find((t) => t[0] === "e")?.[1]).toBe(w.cut.id);
    w.opts.nwc.close();
    w.svc.stop();
  }, 90_000);

  test("one recipient without a Lightning address fails alone; the others are still paid", async () => {
    const w = await scene();
    const noLn = await recipient();
    const scenes = [
      { id: "3".repeat(64), sha256: "c".repeat(64), inSec: 0, outSec: 60, payee: noLn.pub },
      { id: "4".repeat(64), sha256: "d".repeat(64), inSec: 0, outSec: 60, payee: w.a.pub },
    ];
    const cut = await w.cur.s.signEvent(
      buildCut({
        curator: w.cur.pub,
        seriesSlug: "v",
        episode: 2,
        title: "t",
        synopsis: "s",
        scenes,
        price: { amount: 10 },
        curatorBps: 0,
        hostBps: 0,
        host: w.host.pub,
        createdAt: T,
      }),
    );
    const r = await zapSplit({ ...w.opts, cut, sats: 100 });
    expect(r.paid.map((p) => [p.pubkey, p.sats])).toEqual([[w.a.pub, 50]]);
    expect(r.failed).toMatchObject([
      { pubkey: noLn.pub, sats: 50, reason: expect.stringContaining("no Lightning address") },
    ]);
    w.opts.nwc.close();
    w.svc.stop();
  }, 90_000);

  test("a server that does not support zaps is refused rather than paid as a plain invoice", async () => {
    const w = await scene();
    const nozap = await recipient("nozap@x.test");
    const cut = await w.cur.s.signEvent(
      buildCut({
        curator: w.cur.pub,
        seriesSlug: "v",
        episode: 3,
        title: "t",
        synopsis: "s",
        scenes: [
          { id: "5".repeat(64), sha256: "e".repeat(64), inSec: 0, outSec: 60, payee: nozap.pub },
        ],
        price: { amount: 10 },
        curatorBps: 0,
        hostBps: 0,
        host: w.host.pub,
        createdAt: T,
      }),
    );
    const r = await zapSplit({ ...w.opts, cut, sats: 10 });
    expect(r.paid).toEqual([]);
    expect(r.failed[0]?.reason).toMatch(/does not support zaps/);
    w.opts.nwc.close();
    w.svc.stop();
  }, 90_000);

  test("one pubkey in several roles gets one merged payment", async () => {
    const w = await scene();
    const cut = await w.cur.s.signEvent(
      buildCut({
        curator: w.a.pub,
        seriesSlug: "v",
        episode: 4,
        title: "t",
        synopsis: "s",
        scenes: [
          { id: "6".repeat(64), sha256: "f".repeat(64), inSec: 0, outSec: 60, payee: w.a.pub },
        ],
        price: { amount: 10 },
        curatorBps: 2000,
        hostBps: 0,
        host: w.a.pub,
        createdAt: T,
      }),
    );
    const r = await zapSplit({ ...w.opts, cut: { ...cut, pubkey: w.a.pub } as never, sats: 100 });
    expect(r.paid).toHaveLength(1);
    expect(r.paid[0]).toMatchObject({ pubkey: w.a.pub, sats: 100 });
    w.opts.nwc.close();
    w.svc.stop();
  }, 90_000);
});
