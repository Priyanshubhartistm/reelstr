import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { createKeyServer, openLedger } from "@reelstr/keys";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { buildCut, type CutScene, KIND, validateEvent } from "@reelstr/protocol";
import { cleanup, startNutshell, startRelay } from "@reelstr/testkit";
import { buildNutzapInfo, CashuWallet, redeemNutzap, unlockWithNutzap } from "@reelstr/wallet";
import { runPayouts } from "../src";

const mint = await startNutshell();
const relay = await startRelay();
const pool = new RelayPool();
afterAll(() => {
  mint?.stop();
  pool.close([relay.url]);
  cleanup();
});
const nopay = async () => {};
const need = () => {
  if (!mint) throw new Error(".venv-mint is not installed: see requirements-mint.txt");
  return mint;
};
const KEY = "00112233445566778899aabbccddeeff";

describe("key server and split service against the real Nutshell mint", () => {
  test("viewer unlocks with a real nutzap; replay and underpay are refused; token is reusable", async () => {
    const m = need();
    const srv = await createKeyServer({ mints: [m.url] });
    const curator = LocalSigner.generate();
    const reg = await curator.signEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["u", `${srv.url}/episodes`],
        ["method", "POST"],
      ],
      content: "",
    });
    const eventId = "c".repeat(64);
    await fetch(`${srv.url}/episodes`, {
      method: "POST",
      headers: { Authorization: `Nostr ${btoa(JSON.stringify(reg))}` },
      body: JSON.stringify({
        d: "n:ep-001",
        keyHex: KEY,
        ivHex: KEY,
        priceSats: 30,
        free: false,
        cutEventId: eventId,
      }),
    });
    const keyUrl = `${srv.url}/key/${await curator.getPublicKey()}/n:ep-001`;

    const viewer = await CashuWallet.open(m.url);
    await viewer.topUp(100, nopay);
    expect((await fetch(keyUrl)).status).toBe(402);
    const u = await unlockWithNutzap({ keyUrl, wallet: viewer, maxSats: 30 });
    expect(u).toMatchObject({ kind: "token", paidSats: 30 });
    expect(viewer.balance()).toBe(70);
    const res = await fetch(keyUrl, {
      headers: { Authorization: `Reelstr ${(u as { token: string }).token}` },
    });
    expect(bytesToHex(new Uint8Array(await res.arrayBuffer()))).toBe(KEY);
    // the service really holds the money at the real mint
    expect((await srv.walletFor(m.url)).balance()).toBe(30);
    expect(srv.ledger.receipts()).toMatchObject([
      { msats: 30_000, source: "nutzap", cut_event_id: eventId },
    ]);
    srv.stop();
  }, 120_000);

  test("payouts: the split service pays creators with real nutzaps and they can redeem them", async () => {
    const m = need();
    const mk = async () => {
      const s = LocalSigner.generate();
      const lockPriv = bytesToHex(randomBytes(32));
      const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
      await pool.publish(
        await s.signEvent(buildNutzapInfo({ p2pk: lockPub, mints: [m.url], relays: [relay.url] })),
        [relay.url],
      );
      return { s, pub: await s.getPublicKey(), lockPriv };
    };
    const [a, b, cur, host] = [await mk(), await mk(), await mk(), await mk()];
    const sc = (who: { pub: string }, secs: number): CutScene => ({
      id: bytesToHex(randomBytes(32)),
      sha256: bytesToHex(randomBytes(32)),
      inSec: 0,
      outSec: secs,
      payee: who.pub,
    });
    const scenes = [sc(a, 62), sc(b, 38)];
    const cut = await cur.s.signEvent(
      buildCut({
        curator: cur.pub,
        seriesSlug: "n",
        episode: 1,
        title: "t",
        synopsis: "s",
        scenes,
        price: { amount: 1000 },
        curatorBps: 2000,
        hostBps: 1000,
        host: host.pub,
        createdAt: Math.floor(Date.now() / 1000),
      }),
    );
    expect(validateEvent(cut, { verifySig: true }).ok).toBe(true);
    await pool.publish(cut, [relay.url]);

    const ledger = openLedger();
    const svcWallet = await CashuWallet.open(m.url, ledger.proofStore(m.url));
    await svcWallet.topUp(2000, nopay);
    ledger.addReceipt({
      cut_key: `${cur.pub}/n:ep-001`,
      cut_event_id: cut.id,
      msats: 1_000_000,
      source: "nutzap",
      ref: "r1",
    });
    const rep = await runPayouts({
      acknowledgeCustody: true,
      ledger,
      pool,
      relays: [relay.url],
      identity: LocalSigner.generate(),
      mints: [m.url],
      walletFor: async () => svcWallet,
    });
    expect(rep.skipped).toEqual([]);
    const by = new Map(rep.batches[0]?.paid.map((p) => [p.pubkey, p.msats]));
    expect(by.get(a.pub)).toBe(434_000);
    expect(by.get(b.pub)).toBe(266_000);
    // curator and host have published nutzap info too, so they are paid as well
    expect(by.get(cur.pub)).toBe(200_000);
    expect(by.get(host.pub)).toBe(100_000);
    for (const [who, sats] of [
      [a, 434],
      [b, 266],
    ] as const) {
      const zaps = await pool.query([relay.url], { kinds: [KIND.NUTZAP], "#p": [who.pub] });
      expect(zaps.length).toBe(1);
      expect(
        await redeemNutzap(zaps[0] as never, await CashuWallet.open(m.url), who.lockPriv),
      ).toBe(sats);
    }
    expect(svcWallet.balance()).toBe(2000 - 1000);
  }, 180_000);
});
