import { describe, expect, test } from "bun:test";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { decodeInvoice, encodeInvoice, paymentHashOf } from "../src";

// A real mainnet invoice from the BOLT11 spec (BOLT #11 examples): 2500 uBTC = 250,000 sats
const SPEC =
  "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";

describe("bolt11", () => {
  test("decodes the amount and payment hash of a spec invoice", () => {
    const i = decodeInvoice(SPEC);
    expect(i.sats).toBe(250_000);
    expect(i.paymentHash).toBe("0001020304050607080900010203040506070809000102030405060708090102");
    expect(i.description).toBe("1 cup coffee");
    expect(i.expirySec).toBe(60);
  });

  test("round trip: encode then decode", () => {
    const preimage = bytesToHex(randomBytes(32));
    const hash = paymentHashOf(preimage);
    const inv = encodeInvoice({
      sats: 21,
      paymentHash: hash,
      nodeKey: randomBytes(32),
      description: "unlock ep 3",
    });
    const d = decodeInvoice(inv);
    expect(d).toMatchObject({
      sats: 21,
      msats: 21_000,
      paymentHash: hash,
      description: "unlock ep 3",
      expirySec: 3600,
    });
  });

  test("rejects garbage", () => {
    expect(() => decodeInvoice("lnbc1garbage")).toThrow();
    expect(() => decodeInvoice("not an invoice")).toThrow();
  });
});
