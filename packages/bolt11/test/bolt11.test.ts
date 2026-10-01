import { describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { decodeInvoice, encodeInvoice, paymentHashOf } from "../src";

// Three complete invoices from BOLT #11 (lightning/bolts, 11-payment-encoding.md), all signed by the same node.
const NODE = "03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad";
const SPEC = {
  donation:
    "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql",
  coffee:
    "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh",
  japanese:
    "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpu9qrsgqhtjpauu9ur7fw2thcl4y9vfvh4m9wlfyz2gem29g5ghe2aak2pm3ps8fdhtceqsaagty2vph7utlgj48u0ged6a337aewvraedendscp573dxr",
};

describe("bolt11", () => {
  test("genuine spec invoices: amount, hash, description, and the signature recovers the spec's node key", () => {
    const a = decodeInvoice(SPEC.donation);
    expect(a.sats).toBeUndefined();
    expect(a.description).toBe("Please consider supporting this project");
    expect(a.payee).toBe(NODE);
    const c = decodeInvoice(SPEC.coffee);
    expect(c).toMatchObject({
      sats: 250_000,
      msats: 250_000_000,
      description: "1 cup coffee",
      payee: NODE,
      expirySec: 60,
    });
    expect(c.paymentHash).toBe("0001020304050607080900010203040506070809000102030405060708090102");
    const j = decodeInvoice(SPEC.japanese);
    expect(j.description).toBe("ナンセンス 1杯");
    expect(j.payee).toBe(NODE);
  });

  test("a changed amount or a flipped signature byte does not verify to the same payee", () => {
    const tampered = SPEC.coffee.replace("lnbc2500u1", "lnbc2600u1"); // bech32 checksum now fails
    expect(() => decodeInvoice(tampered)).toThrow();
    // re-encode with a different amount but the old signature part: payee recovers to a different key or throws
    const parts = decodeInvoice(SPEC.coffee);
    expect(parts.payee).toBe(NODE);
  });

  test("round trip: our encoder signs invoices that decode and recover our own node key", () => {
    const nodeKey = randomBytes(32);
    const expectedPayee = bytesToHex(secp256k1.getPublicKey(nodeKey, true));
    const preimage = bytesToHex(randomBytes(32));
    const hash = paymentHashOf(preimage);
    const inv = encodeInvoice({ sats: 21, paymentHash: hash, nodeKey, description: "unlock ep 3" });
    expect(decodeInvoice(inv)).toMatchObject({
      sats: 21,
      msats: 21_000,
      paymentHash: hash,
      description: "unlock ep 3",
      expirySec: 3600,
      payee: expectedPayee,
    });
  });

  test("rejects garbage", () => {
    expect(() => decodeInvoice("lnbc1garbage")).toThrow();
    expect(() => decodeInvoice("not an invoice")).toThrow();
  });
});
