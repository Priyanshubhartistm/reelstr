import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { startFakeMint } from "@reelstr/testkit";
import {
  buildNutzap,
  buildNutzapInfo,
  CashuWallet,
  parseNutzap,
  parseNutzapInfo,
  redeemNutzap,
  verifyNutzap,
} from "../src";

const mint = await startFakeMint();
const other = await startFakeMint();
afterAll(() => {
  mint.stop();
  other.stop();
});
const pay = async (inv: string) => {
  try {
    mint.lightning.pay(inv);
  } catch {}
};

async function setup() {
  const alice = await CashuWallet.open(mint.url);
  await alice.topUp(200, pay);
  const bobNostr = LocalSigner.generate();
  const lockPriv = bytesToHex(randomBytes(32)); // bob's nutzap key, NOT his Nostr key
  const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
  const info = await bobNostr.signEvent(
    buildNutzapInfo({ p2pk: lockPub, mints: [mint.url], relays: ["wss://r.example"] }),
  );
  const recipient = await bobNostr.getPublicKey();
  return { alice, lockPriv, lockPub, info, recipient, bobNostr };
}

describe("nutzaps (NIP-61)", () => {
  test("info event round trip; nutzap verify then redeem moves the money", async () => {
    const s = await setup();
    const i = parseNutzapInfo(s.info);
    expect(i).toEqual({ p2pk: s.lockPub, mints: [mint.url], relays: ["wss://r.example"] });
    const proofs = await s.alice.lockedSend(50, i.p2pk);
    const zap = await new LocalSigner(new Uint8Array(32).fill(9)).signEvent(
      buildNutzap({
        proofs,
        mintUrl: mint.url,
        recipient: s.recipient,
        eventId: "a".repeat(64),
        comment: "unlock ep 3",
      }),
    );
    expect(parseNutzap(zap).sats).toBe(50);
    const v = await verifyNutzap(zap, {
      recipient: s.recipient,
      lockPubkey: s.lockPub,
      acceptedMints: [mint.url],
      minSats: 50,
    });
    expect(v.sats).toBe(50);
    const bob = await CashuWallet.open(mint.url);
    expect(await redeemNutzap(zap, bob, s.lockPriv)).toBe(50);
    expect(bob.balance()).toBe(50);
    expect(s.alice.balance()).toBe(150);
    // the same nutzap cannot be redeemed twice: the mint says spent
    await expect(redeemNutzap(zap, await CashuWallet.open(mint.url), s.lockPriv)).rejects.toThrow();
  }, 60_000);

  test("rejections: wrong recipient, wrong mint, too small, locked to someone else, tampered DLEQ", async () => {
    const s = await setup();
    const proofs = await s.alice.lockedSend(20, s.lockPub);
    const base = {
      recipient: s.recipient,
      lockPubkey: s.lockPub,
      acceptedMints: [mint.url],
      minSats: 20,
    };
    const ev = (over: Partial<Parameters<typeof buildNutzap>[0]> = {}) =>
      new LocalSigner(new Uint8Array(32).fill(9)).signEvent(
        buildNutzap({ proofs, mintUrl: mint.url, recipient: s.recipient, ...over }),
      );
    await expect(verifyNutzap(await ev({ recipient: "b".repeat(64) }), base)).rejects.toThrow(
      /not addressed/,
    );
    await expect(verifyNutzap(await ev(), { ...base, acceptedMints: [other.url] })).rejects.toThrow(
      /not accepted/,
    );
    await expect(verifyNutzap(await ev(), { ...base, minSats: 21 })).rejects.toThrow(/below/);
    await expect(
      verifyNutzap(await ev(), {
        ...base,
        lockPubkey: bytesToHex(getPubKeyFromPrivKey(randomBytes(32))),
      }),
    ).rejects.toThrow(/not locked/);
    const forged = proofs.map((p) => ({
      ...p,
      dleq: { ...(p.dleq as object), s: "00".repeat(32) },
    })) as typeof proofs;
    await expect(verifyNutzap(await ev({ proofs: forged }), base)).rejects.toThrow(/DLEQ/);
    const noDleq = proofs.map(({ dleq: _d, ...p }) => p);
    await expect(verifyNutzap(await ev({ proofs: noDleq }), base)).rejects.toThrow(/no DLEQ/);
  }, 60_000);
});
