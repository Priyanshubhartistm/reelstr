import {
  createBlindSignature,
  createDLEQProof,
  createNewMintKeys,
  hashToCurve,
  isP2PKSpendAuthorised,
  pointFromHex,
  serializeMintKeys,
  verifyUnblindedSignature,
} from "@cashu/cashu-ts";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { decodeInvoice } from "@reelstr/bolt11";
import { FakeLightning } from "./fake-ln";

type Proof = { amount: number; id: string; secret: string; C: string; witness?: unknown };
type Output = { amount: number; id: string; B_: string };

/**
 * A minimal in-process Cashu mint for tests (NUT-01/02/03/04/05/07/10/11/12). Like Nutshell's
 * FakeWallet backend it marks every mint quote paid; melts pay invoices issued by the shared FakeLightning.
 * NEVER point real funds at it: there is no persistence and no real Lightning behind it.
 */
export async function startFakeMint(
  opts: { port?: number; unit?: string; lightning?: FakeLightning } = {},
) {
  const unit = opts.unit ?? "sat";
  const lightning = opts.lightning ?? new FakeLightning();
  const keys = createNewMintKeys(24, randomBytes(32), { unit });
  const pub = serializeMintKeys(keys.pubKeys);
  const spent = new Map<string, unknown>(); // Y -> witness
  const mintQuotes = new Map<string, { amount: number; issued: boolean; request: string }>();
  const meltQuotes = new Map<string, { amount: number; invoice: string; paid: boolean }>();
  /** invoices the mint "paid" on behalf of melts: tests read these */
  const paidInvoices: { invoice: string; sats: number; preimage: string }[] = [];
  const log: string[] = [];

  const Y = (secret: string) => hashToCurve(new TextEncoder().encode(secret)).toHex(true);
  const sign = (o: Output) => {
    const priv = keys.privKeys[String(o.amount)];
    if (!priv) throw new Error(`unsupported amount ${o.amount}`);
    const B_ = pointFromHex(o.B_);
    const sig = createBlindSignature(B_, priv, keys.keysetId);
    const dleq = createDLEQProof(B_, priv);
    return {
      amount: o.amount,
      id: sig.id,
      C_: sig.C_.toHex(true),
      dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) },
    };
  };
  const err = (status: number, code: number, detail: string) =>
    Response.json({ code, detail }, { status });

  /** Verify proofs are genuine, unspent and (for P2PK) properly signed. Returns an error or their total. */
  const checkInputs = (inputs: Proof[]): { error: Response } | { total: number; ys: string[] } => {
    const ys: string[] = [];
    let total = 0;
    for (const p of inputs) {
      const priv = keys.privKeys[String(p.amount)];
      if (!priv || p.id !== keys.keysetId)
        return { error: err(400, 12001, "unknown keyset or amount") };
      const ok = verifyUnblindedSignature(
        { C: pointFromHex(p.C), secret: new TextEncoder().encode(p.secret), id: p.id } as never,
        priv,
      );
      if (!ok) return { error: err(400, 10003, "invalid proof") };
      const y = Y(p.secret);
      if (spent.has(y) || ys.includes(y)) return { error: err(400, 11001, "token already spent") };
      if (p.secret.startsWith("[")) {
        let kind: unknown;
        try {
          kind = (JSON.parse(p.secret) as unknown[])[0];
        } catch {}
        if (kind === "P2PK" && !isP2PKSpendAuthorised(p as never))
          return { error: err(400, 20008, "P2PK witness invalid") };
      }
      ys.push(y);
      total += p.amount;
    }
    return { total, ys };
  };

  const srv = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      try {
        return await handle(req);
      } catch (e) {
        log.push(`ERROR ${(e as Error).message}`);
        return err(500, 99999, (e as Error).message);
      }
    },
  });

  async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const path = u.pathname;
    const body =
      req.method === "POST"
        ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
        : {};
    log.push(`${req.method} ${path}`);
    if (path === "/v1/info")
      return Response.json({
        name: "reelstr-fake-mint",
        pubkey: bytesToHex(randomBytes(33)),
        version: "fake/0.1",
        description: "test mint",
        nuts: {
          "4": {
            methods: [{ method: "bolt11", unit, min_amount: 1, max_amount: 1_000_000 }],
            disabled: false,
          },
          "5": {
            methods: [{ method: "bolt11", unit, min_amount: 1, max_amount: 1_000_000 }],
            disabled: false,
          },
          "7": { supported: true },
          "10": { supported: true },
          "11": { supported: true },
          "12": { supported: true },
        },
      });
    if (path === "/v1/keysets")
      return Response.json({
        keysets: [{ id: keys.keysetId, unit, active: true, input_fee_ppk: 0 }],
      });
    if (path === "/v1/keys" || path === `/v1/keys/${keys.keysetId}`)
      return Response.json({ keysets: [{ id: keys.keysetId, unit, keys: pub }] });
    if (path === "/v1/mint/quote/bolt11" && req.method === "POST") {
      const amount = Number(body.amount);
      const quote = bytesToHex(randomBytes(8));
      const inv = lightning.createInvoice({ sats: amount, description: "mint" });
      lightning.settle(inv.paymentHash); // FakeWallet semantics: quotes are paid immediately
      mintQuotes.set(quote, { amount, issued: false, request: inv.invoice });
      return Response.json({
        quote,
        request: inv.invoice,
        amount,
        unit,
        state: "PAID",
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    const mq = path.match(/^\/v1\/mint\/quote\/bolt11\/(\w+)$/);
    if (mq) {
      const q = mintQuotes.get(mq[1] as string);
      if (!q) return err(404, 20007, "quote not found");
      return Response.json({
        quote: mq[1],
        request: q.request,
        amount: q.amount,
        unit,
        state: q.issued ? "ISSUED" : "PAID",
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    if (path === "/v1/mint/bolt11") {
      const q = mintQuotes.get(String(body.quote));
      if (!q) return err(404, 20007, "quote not found");
      if (q.issued) return err(400, 20002, "already issued");
      const outs = body.outputs as Output[];
      if (outs.reduce((a, o) => a + o.amount, 0) !== q.amount)
        return err(400, 10002, "outputs must equal the quote amount");
      q.issued = true;
      return Response.json({ signatures: outs.map(sign) });
    }
    if (path === "/v1/swap") {
      const c = checkInputs(body.inputs as Proof[]);
      if ("error" in c) return c.error;
      const outs = body.outputs as Output[];
      if (outs.reduce((a, o) => a + o.amount, 0) !== c.total)
        return err(400, 11002, "transaction is not balanced");
      for (const [i, y] of c.ys.entries())
        spent.set(y, (body.inputs as Proof[])[i]?.witness ?? null);
      return Response.json({ signatures: outs.map(sign) });
    }
    if (path === "/v1/checkstate") {
      const ys = body.Ys as string[];
      return Response.json({
        states: ys.map((y) => ({
          Y: y,
          state: spent.has(y) ? "SPENT" : "UNSPENT",
          witness: null,
        })),
      });
    }
    if (path === "/v1/melt/quote/bolt11") {
      const inv = String(body.request);
      let sats: number;
      try {
        sats = decodeInvoice(inv).sats ?? 0;
      } catch {
        return err(400, 20000, "invalid invoice");
      }
      const quote = bytesToHex(randomBytes(8));
      meltQuotes.set(quote, { amount: sats, invoice: inv, paid: false });
      return Response.json({
        quote,
        request: inv,
        amount: sats,
        unit,
        fee_reserve: 0,
        state: "UNPAID",
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    if (path === "/v1/melt/bolt11") {
      const q = meltQuotes.get(String(body.quote));
      if (!q) return err(404, 20007, "quote not found");
      if (q.paid) return err(400, 20005, "quote already paid");
      const c = checkInputs(body.inputs as Proof[]);
      if ("error" in c) return c.error;
      if (c.total < q.amount) return err(400, 11002, "inputs do not cover the invoice");
      for (const [i, y] of c.ys.entries())
        spent.set(y, (body.inputs as Proof[])[i]?.witness ?? null);
      let preimage: string;
      try {
        preimage = lightning.pay(q.invoice).preimage;
      } catch (e) {
        return err(400, 20004, `Lightning payment failed: ${(e as Error).message}`);
      }
      for (const [i, y] of c.ys.entries())
        spent.set(y, (body.inputs as Proof[])[i]?.witness ?? null);
      q.paid = true;
      paidInvoices.push({ invoice: q.invoice, sats: q.amount, preimage });
      const change = c.total - q.amount;
      // NUT-08: the wallet sends blank outputs (amount 0); the mint assigns the change amounts,
      // one power of two per blank output, largest first
      const outs = ((body.outputs as Output[] | undefined) ?? []).slice();
      const parts: number[] = [];
      for (let bit = 30; bit >= 0; bit--) if (change & (1 << bit)) parts.push(1 << bit);
      const sigs = outs
        .slice(0, parts.length)
        .map((o, i) => sign({ ...o, amount: parts[i] as number }));
      return Response.json({
        quote: String(body.quote),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        state: "PAID",
        amount: q.amount,
        unit,
        fee_reserve: 0,
        request: q.invoice,
        payment_preimage: preimage,
        change: sigs,
      });
    }
    return err(404, 0, "not found");
  }

  return {
    url: `http://127.0.0.1:${srv.port}`,
    port: srv.port,
    keysetId: keys.keysetId,
    paidInvoices,
    log,
    lightning,
    isSpent: (secret: string) => spent.has(Y(secret)),
    stop: () => srv.stop(true),
  };
}
