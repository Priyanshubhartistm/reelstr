import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { signedPost, startFakeMint, startLndRegtest } from "@reelstr/testkit";
import { createKeyServer, LndBackend } from "../src";

// Real LND 0.18 nodes on a private regtest chain (podman + bitcoind). Skipped if the images or the
// container CLI are missing. Alice is the service; bob is the viewer paying her invoices.
const cli = process.env.CONTAINER_CLI ?? "podman";
const have =
  Bun.spawnSync([cli, "image", "exists", "docker.io/polarlightning/lnd:0.18.3-beta"]).exitCode ===
    0 &&
  Bun.spawnSync([cli, "image", "exists", "docker.io/polarlightning/bitcoind:27.0"]).exitCode === 0;

let net: Awaited<ReturnType<typeof startLndRegtest>>;
let alice: LndBackend;
// LND's REST uses a self-signed cert: tests skip verification, production passes `ca`
const insecure = (i: string, o?: RequestInit) =>
  fetch(i, { ...o, tls: { rejectUnauthorized: false } } as RequestInit);

beforeAll(async () => {
  if (!have) return;
  net = await startLndRegtest();
  alice = new LndBackend(
    `https://127.0.0.1:${net.alice.restPort}`,
    net.alice.macaroon,
    undefined,
    insecure,
  );
}, 300_000);
afterAll(async () => {
  await net?.stop();
});

const bobPays = (invoice: string) => net.bob.cli("payinvoice", "--force", "--json", invoice);

describe.skipIf(!have)("LndBackend against real LND on regtest", () => {
  test("createInvoice -> unpaid -> a real payment settles it; unknown hash is not paid", async () => {
    const inv = await alice.createInvoice({ sats: 100, description: "reelstr test" });
    expect(inv.invoice.startsWith("lnbcrt")).toBe(true);
    expect(await alice.isPaid(inv.paymentHash)).toBe(false);
    const paid = JSON.parse((await bobPays(inv.invoice)).out) as {
      payment_preimage: string;
      status: string;
    };
    expect(bytesToHex(sha256(hexToBytes(paid.payment_preimage)))).toBe(inv.paymentHash);
    expect(await alice.isPaid(inv.paymentHash)).toBe(true);
    expect(await alice.isPaid(bytesToHex(randomBytes(32)))).toBe(false);
  }, 120_000);

  test("payInvoice pays a real invoice and returns the preimage that hashes to its payment hash", async () => {
    const add = JSON.parse((await net.bob.cli("addinvoice", "--amt=50")).out) as {
      payment_request: string;
      r_hash: string;
    };
    const r = await alice.payInvoice(add.payment_request);
    expect(bytesToHex(sha256(hexToBytes(r.preimage)))).toBe(add.r_hash);
    const state = JSON.parse((await net.bob.cli("lookupinvoice", add.r_hash)).out) as {
      state: string;
    };
    expect(state.state).toBe("SETTLED");
  }, 120_000);

  test("failures surface as errors: already paid, and an amount no channel can carry", async () => {
    const add = JSON.parse((await net.bob.cli("addinvoice", "--amt=10")).out) as {
      payment_request: string;
    };
    await alice.payInvoice(add.payment_request);
    await expect(alice.payInvoice(add.payment_request)).rejects.toThrow(/could not pay/);
    const big = JSON.parse((await net.bob.cli("addinvoice", "--amt=900000")).out) as {
      payment_request: string;
    };
    await expect(alice.payInvoice(big.payment_request)).rejects.toThrow(/could not pay/);
  }, 180_000);

  test("key server L402 unlock with a real Lightning payment: pay -> preimage -> key, once", async () => {
    const mint = await startFakeMint();
    const srv = await createKeyServer({ mints: [mint.url], ln: alice, tokenTtlSec: 3600 });
    try {
      const curator = LocalSigner.generate();
      const d = "real-ln:ep-001";
      const reg = await signedPost(curator, `${srv.url}/episodes`, {
        d,
        keyHex: "00112233445566778899aabbccddeeff",
        ivHex: "ff".repeat(16),
        priceSats: 21,
        free: false,
        cutEventId: "c".repeat(64),
      });
      expect(reg.status).toBe(201);
      const path = `/key/${await curator.getPublicKey()}/${encodeURIComponent(d)}`;
      const get = (a?: string) =>
        fetch(`${srv.url}${path}`, { headers: a ? { Authorization: a } : {} });
      expect((await get()).status).toBe(402);
      const { invoice, paymentHash } = (await (
        await fetch(`${srv.url}/invoice${path.slice(4)}`, { method: "POST" })
      ).json()) as { invoice: string; paymentHash: string };
      expect((await get(`L402 ${paymentHash}:${bytesToHex(randomBytes(32))}`)).status).toBe(402); // unpaid + wrong preimage
      const paid = JSON.parse((await bobPays(invoice)).out) as { payment_preimage: string };
      const ok = await get(`L402 ${paymentHash}:${paid.payment_preimage}`);
      expect(ok.status).toBe(200);
      expect((await get(`L402 ${paymentHash}:${paid.payment_preimage}`)).status).toBe(402); // reuse refused
    } finally {
      srv.stop();
      mint.stop();
    }
  }, 180_000);
});
