import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { startFakeMint } from "@reelstr/testkit";
import { CashuWallet, MemoryStore } from "../src";

const mint = await startFakeMint();
afterAll(() => mint.stop());
// the fake mint settles its own quotes (FakeWallet semantics), so a real payer would find them paid
const pay = async (inv: string) => {
  try {
    mint.lightning.pay(inv);
  } catch {}
};

describe("CashuWallet", () => {
  test("top up, locked send, receive, pay invoice; balances add up", async () => {
    const w = await CashuWallet.open(mint.url);
    expect(await w.topUp(100, pay)).toBe(100);
    const priv = bytesToHex(randomBytes(32));
    const pub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(priv)));
    const locked = await w.lockedSend(30, pub);
    expect(locked.reduce((a, p) => a + p.amount, 0)).toBe(30);
    expect(w.balance()).toBe(70);
    const w2 = await CashuWallet.open(mint.url);
    expect(await w2.receive(locked, priv)).toBe(30);
    expect(w2.balance()).toBe(30);
    const { invoice } = mint.lightning.createInvoice({ sats: 12 });
    const r = await w.payInvoice(invoice);
    expect(r.sats).toBe(12);
    expect(r.preimage).toHaveLength(64);
    expect(w.balance()).toBe(58);
  }, 60_000);

  test("refuses to overspend, and a mint invoice for the wrong amount is not paid", async () => {
    const w = await CashuWallet.open(mint.url);
    await w.topUp(10, pay);
    await expect(w.lockedSend(50, "02".padEnd(66, "a"))).rejects.toThrow(/below/);
    const { invoice } = mint.lightning.createInvoice({ sats: 99 });
    await expect(w.payInvoice(invoice)).rejects.toThrow(/need 99/);
  }, 60_000);

  test("prune drops proofs spent elsewhere; persistence via the store", async () => {
    const store = new MemoryStore();
    const a = await CashuWallet.open(mint.url, store);
    await a.topUp(40, pay);
    const b = await CashuWallet.open(mint.url, new MemoryStore(a.list())); // same proofs, other device
    await b.receive(a.list()); // spends them at the mint
    expect(await a.prune()).toBeGreaterThan(0);
    expect(a.balance()).toBe(0);
    expect((await store.load()).length).toBe(0);
  }, 60_000);
});
