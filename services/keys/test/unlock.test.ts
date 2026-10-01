import { afterAll, describe, expect, test } from "bun:test";
import { LocalSigner } from "@reelstr/nostr";
import {
  cleanup,
  FakeLightning,
  signedPost,
  startFakeMint,
  startFakeNwc,
  startRelay,
} from "@reelstr/testkit";
import {
  CashuWallet,
  keyHeaders,
  NwcWallet,
  SpendGuard,
  unlockWithLightning,
  unlockWithNutzap,
} from "@reelstr/wallet";
import { createKeyServer } from "../src";

const relay = await startRelay();
const ln = new FakeLightning();
const mint = await startFakeMint({ lightning: ln });
const srv = await createKeyServer({
  mints: [mint.url],
  ln: {
    createInvoice: async (o) => ln.createInvoice(o),
    isPaid: async (h) => ln.isPaid(h),
    payInvoice: async (i) => ({ preimage: ln.pay(i).preimage }),
  },
});
afterAll(() => {
  srv.stop();
  mint.stop();
  cleanup();
});
const settle = async (i: string) => {
  try {
    ln.pay(i);
  } catch {}
};
const memory = () => {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
};

const curator = LocalSigner.generate();
const eventId = "e".repeat(64);
async function register(d: string, price: number, free = false) {
  await signedPost(curator, `${srv.url}/episodes`, {
    d,
    keyHex: "00".repeat(16),
    ivHex: "11".repeat(16),
    priceSats: price,
    free,
    cutEventId: eventId,
  });
  const pk = await curator.getPublicKey();
  return {
    keyUrl: `${srv.url}/key/${pk}/${encodeURIComponent(d)}`,
    invoiceUrl: `${srv.url}/invoice/${pk}/${encodeURIComponent(d)}`,
  };
}

describe("unlock flows (FE-8)", () => {
  test("free episode: no wallet needed; paid: nutzap unlock spends exactly the price and gives a token", async () => {
    const free = await register("u-free:ep-001", 50, true);
    expect(
      await unlockWithNutzap({ keyUrl: free.keyUrl, wallet: await CashuWallet.open(mint.url) }),
    ).toEqual({ kind: "free" });

    const paid = await register("u-paid:ep-001", 40);
    const w = await CashuWallet.open(mint.url);
    await w.topUp(100, settle);
    const guard = new SpendGuard(memory(), 500);
    const u = await unlockWithNutzap({ keyUrl: paid.keyUrl, wallet: w, guard, maxSats: 40 });
    expect(u).toMatchObject({ kind: "token", paidSats: 40 });
    expect(w.balance()).toBe(60);
    expect(guard.spent()).toBe(40);
    // the token then plays the episode, and keyHeaders is what the player sends on the key request
    const res = await fetch(paid.keyUrl, { headers: keyHeaders(u) });
    expect(res.status).toBe(200);
  }, 60_000);

  test("nothing is spent when the price rose, the balance is short, the mint differs, or the cap would be broken", async () => {
    const paid = await register("u-guard:ep-001", 40);
    const w = await CashuWallet.open(mint.url);
    await w.topUp(100, settle);
    await expect(unlockWithNutzap({ keyUrl: paid.keyUrl, wallet: w, maxSats: 10 })).rejects.toThrow(
      /more than the 10/,
    );
    await expect(
      unlockWithNutzap({ keyUrl: paid.keyUrl, wallet: w, guard: new SpendGuard(memory(), 30) }),
    ).rejects.toThrow(/daily spending cap/);
    const poor = await CashuWallet.open(mint.url);
    await expect(unlockWithNutzap({ keyUrl: paid.keyUrl, wallet: poor })).rejects.toThrow(
      /below the price/,
    );
    const other = await startFakeMint();
    await expect(
      unlockWithNutzap({ keyUrl: paid.keyUrl, wallet: await CashuWallet.open(other.url) }),
    ).rejects.toThrow(/sold at/);
    other.stop();
    expect(w.balance()).toBe(100);
  }, 60_000);

  test("the daily cap resets the next day", () => {
    let day = "2026-10-01";
    const g = new SpendGuard(memory(), 100, () => day);
    g.record(90);
    expect(() => g.check(20)).toThrow(/cap/);
    day = "2026-10-02";
    expect(() => g.check(20)).not.toThrow();
    expect(g.spent()).toBe(0);
  });

  test("Lightning unlock through NWC", async () => {
    const paid = await register("u-ln:ep-001", 21);
    const svc = await startFakeNwc({ relay: relay.url, lightning: ln, balanceSats: 100 });
    const nwc = NwcWallet.fromUri(svc.uri, 10_000);
    const u = await unlockWithLightning({
      ...paid,
      pay: (inv, sats) => nwc.payInvoice(inv, sats),
      guard: new SpendGuard(memory(), 500),
    });
    expect(u).toMatchObject({ kind: "token", paidSats: 21 });
    expect(await nwc.getBalanceSats()).toBe(79);
    nwc.close();
    svc.stop();
  }, 60_000);
});
