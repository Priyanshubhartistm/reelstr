import { afterAll, describe, expect, test } from "bun:test";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { cleanup, FakeLightning, startFakeMint, startFakeNwc, startRelay } from "@reelstr/testkit";
import { CashuWallet, Nip60Store, NwcError, NwcWallet, parseNwcUri } from "../src";

const relay = await startRelay();
const ln = new FakeLightning();
const mint = await startFakeMint({ lightning: ln });
afterAll(() => {
  mint.stop();
  cleanup();
});

describe("NWC (NIP-47)", () => {
  test("parse: valid and invalid URIs", () => {
    const pk = "a".repeat(64);
    expect(
      parseNwcUri(
        `nostr+walletconnect://${pk}?relay=wss%3A%2F%2Fr.example&secret=${"b".repeat(64)}&lud16=me%40x.com`,
      ),
    ).toEqual({
      walletPubkey: pk,
      relay: "wss://r.example",
      secret: "b".repeat(64),
      lud16: "me@x.com",
    });
    expect(() => parseNwcUri("nostr+walletconnect://zz?relay=x&secret=y")).toThrow();
    expect(() => parseNwcUri(`nostr+walletconnect://${pk}?secret=${"b".repeat(64)}`)).toThrow();
  });

  test("pay an invoice, read balance, make an invoice; preimage is verified", async () => {
    const svc = await startFakeNwc({ relay: relay.url, lightning: ln, balanceSats: 1000 });
    const w = NwcWallet.fromUri(svc.uri, 10_000);
    expect(await w.getBalanceSats()).toBe(1000);
    const { invoice } = ln.createInvoice({ sats: 25 });
    const r = await w.payInvoice(invoice, 25);
    expect(r.preimage).toHaveLength(64);
    expect(await w.getBalanceSats()).toBe(975);
    const made = await w.makeInvoice(40, "unlock");
    expect(ln.isPaid(made.paymentHash)).toBe(false);
    // refuses to pay an invoice for a different amount than the UI promised
    await expect(w.payInvoice(ln.createInvoice({ sats: 99 }).invoice, 25)).rejects.toThrow(
      /expected 25/,
    );
    w.close();
    svc.stop();
  }, 60_000);

  test("wallet errors surface with their code; silence times out", async () => {
    const svc = await startFakeNwc({
      relay: relay.url,
      lightning: ln,
      balanceSats: 10,
      failPayments: true,
    });
    const w = NwcWallet.fromUri(svc.uri, 10_000);
    await expect(w.payInvoice(ln.createInvoice({ sats: 5 }).invoice)).rejects.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    w.close();
    svc.stop();
    const dead = NwcWallet.fromUri(svc.uri, 1500);
    await expect(dead.getBalanceSats()).rejects.toThrow(NwcError);
    dead.close();
  }, 60_000);
});

describe("NIP-60 store (FE-9)", () => {
  test("a second device sees the same balance; spending on one updates the other; history and meta sync", async () => {
    const signer = LocalSigner.generate();
    const pool = new RelayPool();
    const dev1 = new Nip60Store(pool, [relay.url], signer, mint.url);
    const w1 = await CashuWallet.open(mint.url, dev1);
    await w1.topUp(100, async (inv) => {
      try {
        ln.pay(inv);
      } catch {}
    });
    await dev1.record("in", 100, "top up");
    await dev1.saveMeta({ privkey: "c".repeat(64), mints: [mint.url] });

    const dev2 = new Nip60Store(pool, [relay.url], signer, mint.url);
    const w2 = await CashuWallet.open(mint.url, dev2);
    expect(w2.balance()).toBe(100);
    expect(await dev2.loadMeta()).toEqual({ privkey: "c".repeat(64), mints: [mint.url] });
    expect((await dev2.history())[0]).toMatchObject({ direction: "in", sats: 100, note: "top up" });

    const { invoice } = ln.createInvoice({ sats: 30 });
    await w2.payInvoice(invoice);
    expect(w2.balance()).toBe(70);
    // device 1 reloads: the replaced token event is gone, so it sees 70, not 170
    const w1b = await CashuWallet.open(
      mint.url,
      new Nip60Store(pool, [relay.url], signer, mint.url),
    );
    expect(w1b.balance()).toBe(70);
    // a different user cannot read or use it
    const other = await CashuWallet.open(
      mint.url,
      new Nip60Store(pool, [relay.url], LocalSigner.generate(), mint.url),
    );
    expect(other.balance()).toBe(0);
    pool.close([relay.url]);
  }, 90_000);
});
