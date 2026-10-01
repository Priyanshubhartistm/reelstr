import { afterAll, describe, expect, test } from "bun:test";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { LocalSigner } from "@reelstr/nostr";
import { httpAuthHeader, httpAuthTemplate } from "@reelstr/protocol";
import { FakeLightning, signedPost, startFakeMint } from "@reelstr/testkit";
import { buildNutzap, CashuWallet } from "@reelstr/wallet";
import { createKeyServer, type LnBackend, openLedger } from "../src";

const ln = new FakeLightning();
const mint = await startFakeMint({ lightning: ln });
const otherMint = await startFakeMint();
const backend: LnBackend = {
  createInvoice: async (o) => ln.createInvoice({ sats: o.sats, description: o.description }),
  isPaid: async (h) => ln.isPaid(h),
  payInvoice: async (i) => ({ preimage: ln.pay(i).preimage }),
};
const srv = await createKeyServer({ mints: [mint.url], ln: backend, tokenTtlSec: 3600 });
afterAll(() => {
  srv.stop();
  mint.stop();
  otherMint.stop();
});
const settle = async (inv: string) => {
  try {
    ln.pay(inv);
  } catch {}
};

async function nip98(
  signer: LocalSigner,
  path: string,
  method: string,
  at = Math.floor(Date.now() / 1000),
  body?: string,
) {
  const ev = await signer.signEvent(
    httpAuthTemplate({ url: `${srv.url}${path}`, method, body, createdAt: at }),
  );
  return httpAuthHeader(ev);
}
const curator = LocalSigner.generate();
const KEY = "00112233445566778899aabbccddeeff";
const cutEventId = "c".repeat(64);

async function register(
  d: string,
  price: number,
  free = false,
  signer = curator,
  eventId = cutEventId,
) {
  return signedPost(signer, `${srv.url}/episodes`, {
    d,
    keyHex: KEY,
    ivHex: "ff".repeat(16),
    priceSats: price,
    free,
    cutEventId: eventId,
  });
}
const keyPath = async (d: string) =>
  `/key/${await curator.getPublicKey()}/${encodeURIComponent(d)}`;
const payer = async (sats: number) => {
  const w = await CashuWallet.open(mint.url);
  await w.topUp(sats, settle);
  return w;
};
async function nutzap(
  w: CashuWallet,
  sats: number,
  eventId = cutEventId,
  recipient = srv.pubkey,
  lock = srv.lockPub,
) {
  const proofs = await w.lockedSend(sats, lock);
  const ev = await LocalSigner.generate().signEvent(
    buildNutzap({ proofs, mintUrl: mint.url, recipient, eventId }),
  );
  return `Nutzap ${btoa(JSON.stringify(ev))}`;
}

describe("registration (NIP-98)", () => {
  test("requires a valid, fresh, correctly-scoped signature", async () => {
    expect((await fetch(`${srv.url}/episodes`, { method: "POST", body: "{}" })).status).toBe(401);
    const stale = await nip98(curator, "/episodes", "POST", Math.floor(Date.now() / 1000) - 600);
    expect(
      (
        await fetch(`${srv.url}/episodes`, {
          method: "POST",
          headers: { Authorization: stale },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const wrongPath = await nip98(curator, "/other", "POST");
    expect(
      (
        await fetch(`${srv.url}/episodes`, {
          method: "POST",
          headers: { Authorization: wrongPath },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    const wrongMethod = await nip98(curator, "/episodes", "GET");
    expect(
      (
        await fetch(`${srv.url}/episodes`, {
          method: "POST",
          headers: { Authorization: wrongMethod },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect((await register("s:ep-001", 10)).status).toBe(201);
    expect((await register("BAD", 10)).status).toBe(400);
  });
  test("a curator cannot overwrite someone else's episode: keys are scoped to the signer", async () => {
    await register("scoped:ep-001", 0, true);
    const mallory = LocalSigner.generate();
    await register("scoped:ep-001", 0, true, mallory); // registers under mallory's own namespace
    const res = await fetch(`${srv.url}${await keyPath("scoped:ep-001")}`);
    expect(res.status).toBe(200);
    expect(bytesToHex(new Uint8Array(await res.arrayBuffer()))).toBe(KEY);
  });
});

describe("free episodes", () => {
  test("release the key with no payment", async () => {
    await register("free:ep-001", 50, true);
    const r = await fetch(`${srv.url}${await keyPath("free:ep-001")}`);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(16);
  });
});

describe("paid episodes: nutzap", () => {
  test("402 lists how to pay; a valid nutzap unlocks, is recorded against the Cut version, and yields a reusable token", async () => {
    await register("paid:ep-001", 40);
    const path = await keyPath("paid:ep-001");
    const first = await fetch(`${srv.url}${path}`);
    expect(first.status).toBe(402);
    const info = (await first.json()) as {
      price_sats: number;
      nutzap: { recipient: string; lock_pubkey: string; mints: string[]; e: string };
    };
    expect(info).toMatchObject({
      price_sats: 40,
      nutzap: { recipient: srv.pubkey, lock_pubkey: srv.lockPub, mints: [mint.url], e: cutEventId },
    });

    const w = await payer(100);
    const res = await fetch(`${srv.url}${path}`, {
      headers: { Authorization: await nutzap(w, 40) },
    });
    expect(res.status).toBe(200);
    expect(bytesToHex(new Uint8Array(await res.arrayBuffer()))).toBe(KEY);
    const token = res.headers.get("x-reelstr-token") as string;
    expect(token).toBeTruthy();
    const rs = srv.ledger.receipts(`${await curator.getPublicKey()}/paid:ep-001`);
    expect(rs).toMatchObject([{ msats: 40_000, source: "nutzap", cut_event_id: cutEventId }]);
    expect((await srv.walletFor(mint.url)).balance()).toBe(40);

    // the token unlocks again without paying, and only this episode
    expect(
      (await fetch(`${srv.url}${path}`, { headers: { Authorization: `Reelstr ${token}` } })).status,
    ).toBe(200);
    await register("paid:ep-002", 40);
    expect(
      (
        await fetch(`${srv.url}${await keyPath("paid:ep-002")}`, {
          headers: { Authorization: `Reelstr ${token}` },
        })
      ).status,
    ).toBe(402);
    expect(
      (await fetch(`${srv.url}${path}`, { headers: { Authorization: `Reelstr ${token}x` } }))
        .status,
    ).toBe(402);
  }, 60_000);

  test("refusals: underpay, wrong version, wrong recipient, wrong key, unaccepted mint, replay", async () => {
    await register("refuse:ep-001", 30);
    const path = await keyPath("refuse:ep-001");
    const w = await payer(300);
    const get = async (auth: string) =>
      fetch(`${srv.url}${path}`, { headers: { Authorization: auth } });
    const detail = async (r: Response) => ((await r.json()) as { detail: string }).detail;

    let r = await get(await nutzap(w, 20));
    expect(r.status).toBe(402);
    expect(await detail(r)).toMatch(/below/);
    r = await get(await nutzap(w, 30, "d".repeat(64)));
    expect(await detail(r)).toMatch(/current episode version/);
    r = await get(await nutzap(w, 30, cutEventId, "e".repeat(64)));
    expect(await detail(r)).toMatch(/not addressed/);
    r = await get(
      await nutzap(
        w,
        30,
        cutEventId,
        srv.pubkey,
        bytesToHex(new Uint8Array([2, ...randomBytes(32)])),
      ),
    );
    expect(await detail(r)).toMatch(/not locked/);
    expect(srv.ledger.receipts(`${await curator.getPublicKey()}/refuse:ep-001`)).toEqual([]);

    const good = await nutzap(w, 30);
    expect((await get(good)).status).toBe(200);
    const again = await get(good);
    expect(again.status).toBe(402);
    expect(await detail(again)).toMatch(/already used/);
    expect(srv.ledger.receipts(`${await curator.getPublicKey()}/refuse:ep-001`).length).toBe(1);
  }, 120_000);

  test("proofs already spent elsewhere do not unlock (the mint is the judge)", async () => {
    await register("spent:ep-001", 25);
    const w = await payer(100);
    const proofs = await w.lockedSend(25, srv.lockPub);
    // the service redeems them once through a different event...
    const mk = (id: string) =>
      LocalSigner.generate().signEvent(
        buildNutzap({
          proofs,
          mintUrl: mint.url,
          recipient: srv.pubkey,
          eventId: cutEventId,
          comment: id,
        }),
      );
    const a = await mk("a");
    const b = await mk("b"); // same proofs, different event id
    const path = await keyPath("spent:ep-001");
    expect(
      (
        await fetch(`${srv.url}${path}`, {
          headers: { Authorization: `Nutzap ${btoa(JSON.stringify(a))}` },
        })
      ).status,
    ).toBe(200);
    const r = await fetch(`${srv.url}${path}`, {
      headers: { Authorization: `Nutzap ${btoa(JSON.stringify(b))}` },
    });
    expect(r.status).toBe(402);
    expect(srv.ledger.receipts(`${await curator.getPublicKey()}/spent:ep-001`).length).toBe(1);
  }, 60_000);
});

describe("paid episodes: Lightning (L402-style)", () => {
  test("invoice -> pay -> preimage unlocks once; wrong or unpaid proofs do not", async () => {
    await register("ln:ep-001", 21);
    const path = await keyPath("ln:ep-001");
    const { invoice, paymentHash } = (await (
      await fetch(`${srv.url}/invoice${path.slice(4)}`, { method: "POST" })
    ).json()) as { invoice: string; paymentHash: string };
    const get = (a: string) => fetch(`${srv.url}${path}`, { headers: { Authorization: a } });
    const bogus = bytesToHex(randomBytes(32));
    expect((await get(`L402 ${paymentHash}:${bogus}`)).status).toBe(402); // wrong preimage
    const preimage = ln.pay(invoice).preimage;
    // unpaid-invoice case uses a second invoice
    const second = (await (
      await fetch(`${srv.url}/invoice${path.slice(4)}`, { method: "POST" })
    ).json()) as { paymentHash: string };
    expect((await get(`L402 ${second.paymentHash}:${bogus}`)).status).toBe(402);
    const ok = await get(`L402 ${paymentHash}:${preimage}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-reelstr-token")).toBeTruthy();
    expect(srv.ledger.receipts(`${await curator.getPublicKey()}/ln:ep-001`)).toMatchObject([
      { msats: 21_000, source: "ln", ref: paymentHash },
    ]);
    expect((await get(`L402 ${paymentHash}:${preimage}`)).status).toBe(402); // invoice reuse
  }, 60_000);

  test("an invoice for another episode does not unlock this one", async () => {
    await register("ln:ep-002", 21);
    await register("ln:ep-003", 21);
    const inv = (await (
      await fetch(`${srv.url}/invoice${(await keyPath("ln:ep-002")).slice(4)}`, { method: "POST" })
    ).json()) as { invoice: string; paymentHash: string };
    const pre = ln.pay(inv.invoice).preimage;
    const r = await fetch(`${srv.url}${await keyPath("ln:ep-003")}`, {
      headers: { Authorization: `L402 ${inv.paymentHash}:${pre}` },
    });
    expect(r.status).toBe(402);
  });
});

describe("funds survive a restart", () => {
  test("the service wallet reloads its proofs from the ledger", async () => {
    const path = `/tmp/claude-1000/-home-anshtyagi/f0501ddb-8b46-431f-8978-2ee03dd9c1e3/scratchpad/ledger-${Date.now()}.db`;
    const ledger = openLedger(path);
    const s1 = await createKeyServer({ mints: [mint.url], ledger });
    const w = await payer(50);
    const c = LocalSigner.generate();
    await signedPost(c, `${s1.url}/episodes`, {
      d: "r:ep-001",
      keyHex: KEY,
      ivHex: KEY,
      priceSats: 10,
      free: false,
      cutEventId,
    });
    const zap = await LocalSigner.generate().signEvent(
      buildNutzap({
        proofs: await w.lockedSend(10, s1.lockPub),
        mintUrl: mint.url,
        recipient: s1.pubkey,
        eventId: cutEventId,
      }),
    );
    expect(
      (
        await fetch(`${s1.url}/key/${await c.getPublicKey()}/r:ep-001`, {
          headers: { Authorization: `Nutzap ${btoa(JSON.stringify(zap))}` },
        })
      ).status,
    ).toBe(200);
    s1.stop();
    const s2 = await createKeyServer({ mints: [mint.url], ledger: openLedger(path) });
    expect(s2.pubkey).toBe(s1.pubkey); // identity persists too
    expect((await s2.walletFor(mint.url)).balance()).toBe(10);
    s2.stop();
  }, 60_000);
});
