import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { startNutshell } from "@reelstr/testkit";
import { buildNutzap, CashuWallet, redeemNutzap, verifyNutzap } from "../src";

const mint = await startNutshell();
afterAll(() => mint?.stop());
const need = () => {
  if (!mint) throw new Error(".venv-mint is not installed: see requirements-mint.txt");
  return mint;
};

// Nutshell's FakeWallet pays every mint quote on request, so no invoice has to be settled.
const nopay = async () => {};

describe("against the real Nutshell mint", () => {
  test("NUT-06 info lists the NUTs we depend on", async () => {
    const info = (await (await fetch(`${need().url}/v1/info`)).json()) as {
      version: string;
      nuts: Record<string, unknown>;
    };
    expect(info.version).toContain("Nutshell");
    for (const n of ["4", "5", "7", "10", "11", "12"]) expect(info.nuts[n]).toBeTruthy();
  }, 60_000);

  test("top up, P2PK-locked send with DLEQ, nutzap verify + redeem, double spend refused", async () => {
    const m = need();
    const alice = await CashuWallet.open(m.url);
    expect(await alice.topUp(100, nopay)).toBe(100);
    const lockPriv = bytesToHex(randomBytes(32));
    const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
    const proofs = await alice.lockedSend(40, lockPub);
    expect(proofs.every((p) => p.dleq)).toBe(true);
    expect(alice.balance()).toBe(60);
    const bobNostr = await new LocalSigner(new Uint8Array(32).fill(5)).getPublicKey();
    const zap = await LocalSigner.generate().signEvent(
      buildNutzap({ proofs, mintUrl: m.url, recipient: bobNostr, eventId: "a".repeat(64) }),
    );
    expect(
      await verifyNutzap(zap, {
        recipient: bobNostr,
        lockPubkey: lockPub,
        acceptedMints: [m.url],
        minSats: 40,
      }),
    ).toMatchObject({ sats: 40 });
    const bob = await CashuWallet.open(m.url);
    expect(await redeemNutzap(zap, bob, lockPriv)).toBe(40);
    expect(bob.balance()).toBe(40);
    // the real mint's spent-state is what stops a replay
    await expect(redeemNutzap(zap, await CashuWallet.open(m.url), lockPriv)).rejects.toThrow();
    expect(await bob.prune()).toBe(0);
    expect(await alice.prune()).toBe(0);
  }, 120_000);

  test("proofs locked to someone else cannot be redeemed with the wrong key", async () => {
    const m = need();
    const w = await CashuWallet.open(m.url);
    await w.topUp(50, nopay);
    const lockPub = bytesToHex(getPubKeyFromPrivKey(randomBytes(32)));
    const proofs = await w.lockedSend(20, lockPub);
    const thief = await CashuWallet.open(m.url);
    await expect(thief.receive(proofs, bytesToHex(randomBytes(32)))).rejects.toThrow();
    expect(thief.balance()).toBe(0);
  }, 120_000);

  test("prune drops proofs spent from another device", async () => {
    const m = need();
    const a = await CashuWallet.open(m.url);
    await a.topUp(30, nopay);
    const b = await CashuWallet.open(m.url);
    await b.receive(a.list()); // spends them at the mint
    expect(await a.prune()).toBeGreaterThan(0);
    expect(a.balance()).toBe(0);
  }, 120_000);

  test("melt: pays an invoice, returns the preimage, and the fee stays within the quoted reserve", async () => {
    const m = need();
    const w = await CashuWallet.open(m.url);
    await w.topUp(64, nopay);
    const { encodeInvoice } = await import("@reelstr/bolt11");
    const invoice = encodeInvoice({
      sats: 21,
      paymentHash: bytesToHex(randomBytes(32)),
      nodeKey: randomBytes(32),
    });
    const quote = await w.wallet.createMeltQuoteBolt11(invoice);
    const reserve = quote.fee_reserve.toNumber();
    expect(quote.amount.toNumber()).toBe(21);
    const r = await w.payInvoice(invoice);
    expect(r.sats).toBe(21);
    // the mint refunds the unused reserve as change (NUT-08): we lose the real fee only
    const fee = 64 - 21 - w.balance();
    expect(fee).toBeGreaterThanOrEqual(0);
    expect(fee).toBeLessThanOrEqual(reserve);
    console.log(`real mint: 21 sat melt, fee_reserve ${reserve}, charged ${fee}`);
  }, 120_000);

  test("an invoice the wallet cannot cover is refused before anything is spent", async () => {
    const m = need();
    const w = await CashuWallet.open(m.url);
    await w.topUp(10, nopay);
    const { encodeInvoice } = await import("@reelstr/bolt11");
    const invoice = encodeInvoice({
      sats: 500,
      paymentHash: bytesToHex(randomBytes(32)),
      nodeKey: randomBytes(32),
    });
    await expect(w.payInvoice(invoice)).rejects.toThrow(/need/);
    expect(w.balance()).toBe(10);
  }, 60_000);
});
