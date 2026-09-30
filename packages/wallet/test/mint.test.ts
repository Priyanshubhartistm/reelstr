import { afterAll, describe, expect, test } from "bun:test";
import { getPubKeyFromPrivKey, Wallet } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { startFakeMint } from "@reelstr/testkit";

const mint = await startFakeMint();
afterAll(() => mint.stop());

describe("fake mint speaks enough Cashu for real cashu-ts wallets", () => {
  test("mint, send P2PK-locked, receive with the key, double spend refused", async () => {
    const w = new Wallet(mint.url);
    await w.loadMint();
    const quote = await w.createMintQuoteBolt11(100);
    const proofs = await w.ops.mintBolt11(100, quote).run();
    expect(proofs.reduce((a, p) => a + Number(p.amount), 0)).toBe(100);

    const priv = bytesToHex(randomBytes(32));
    const pub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(priv)));
    const { keep, send } = await w.ops.send(40, proofs).asP2PK({ pubkey: pub }).run();
    expect(send.reduce((a, p) => a + Number(p.amount), 0)).toBe(40);
    expect(keep.reduce((a, p) => a + Number(p.amount), 0)).toBe(60);
    expect(send.every((p) => p.secret.startsWith('["P2PK"'))).toBe(true);
    expect(send.every((p) => p.dleq)).toBe(true); // nutzaps need DLEQ

    // without the key the locked proofs cannot be spent
    await expect(w.ops.receive(send).run()).rejects.toThrow();
    // with it they can
    const got = await w.ops.receive(send).privkey(priv).run();
    expect(got.reduce((a, p) => a + Number(p.amount), 0)).toBe(40);
    // and the original locked proofs are now spent
    await expect(w.ops.receive(send).privkey(priv).run()).rejects.toThrow();
    expect(mint.isSpent(send[0]?.secret as string)).toBe(true);
  }, 60_000);

  test("melt pays a fake invoice and returns change", async () => {
    const w = new Wallet(mint.url);
    await w.loadMint();
    const proofs = await w.ops.mintBolt11(64, await w.createMintQuoteBolt11(64)).run();
    const { invoice } = mint.lightning.createInvoice({ sats: 21 });
    const mq = await w.createMeltQuoteBolt11(invoice);
    const { change } = await w.ops.meltBolt11(mq, proofs).run();
    expect(mint.paidInvoices.at(-1)?.sats).toBe(21);
    expect(change.reduce((a, p) => a + Number(p.amount), 0)).toBe(64 - 21);
  }, 60_000);
});
