import { getPubKeyFromPrivKey } from "@cashu/cashu-ts";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { installUrlRewrite } from "@reelstr/blossom";
import { decodeInvoice, paymentHashOf } from "@reelstr/bolt11";
import { LocalSigner } from "@reelstr/nostr";
import { type EventLike, verifyHttpAuth, verifySignature } from "@reelstr/protocol";
import { CashuWallet, parseNutzap, redeemNutzap, verifyNutzap } from "@reelstr/wallet";
import { type Ledger, openLedger } from "./db";
import { type LnBackend, LndBackend, PhoenixdBackend } from "./ln";

export interface KeyServerOpts {
  ledger?: Ledger;
  ln?: LnBackend;
  /** Cashu mints this service accepts nutzaps on */
  mints: string[];
  port?: number;
  tokenTtlSec?: number;
  /** override the service identity (defaults to keys persisted in the ledger) */
  nsec?: Uint8Array;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Reelstr-Token",
      ...extra,
    },
  });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function createKeyServer(o: KeyServerOpts) {
  const ledger = o.ledger ?? openLedger();
  const ttl = o.tokenTtlSec ?? 7 * 86400;
  const tokenSecret = hexToBytes(ledger.meta("token_secret", () => bytesToHex(randomBytes(32))));
  const lockPriv = ledger.meta("lock_priv", () => bytesToHex(randomBytes(32)));
  const lockPub = bytesToHex(getPubKeyFromPrivKey(hexToBytes(lockPriv)));
  const nsecHex = ledger.meta("nsec", () => bytesToHex(o.nsec ?? randomBytes(32)));
  const identity = new LocalSigner(hexToBytes(nsecHex));
  const pubkey = await identity.getPublicKey();
  const wallets = new Map<string, CashuWallet>();
  const walletFor = async (mint: string) => {
    let w = wallets.get(mint);
    if (!w) {
      w = await CashuWallet.open(mint, ledger.proofStore(mint));
      wallets.set(mint, w);
    }
    return w;
  };

  const mac = (cutKey: string, exp: number) =>
    bytesToHex(hmac(sha256, tokenSecret, new TextEncoder().encode(`${cutKey}|${exp}`)));
  const mintToken = (cutKey: string) => {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    return `${exp}.${mac(cutKey, exp)}`;
  };
  const tokenOk = (cutKey: string, token: string) => {
    const [e, m] = token.split(".");
    const exp = Number(e);
    return Number.isFinite(exp) && exp > Date.now() / 1000 && m === mac(cutKey, exp);
  };

  const keyResponse = (hexKey: string, token?: string) =>
    new Response(hexToBytes(hexKey), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-Reelstr-Token",
        ...(token ? { "X-Reelstr-Token": token } : {}),
      },
    });

  const payInfo = (ep: { price_sats: number; cut_event_id: string }) => ({
    error: "payment required",
    price_sats: ep.price_sats,
    cut_event_id: ep.cut_event_id,
    nutzap: { recipient: pubkey, lock_pubkey: lockPub, mints: o.mints, e: ep.cut_event_id },
    lightning: o.ln
      ? "POST /invoice/<curator>/<d>, pay it, then send Authorization: L402 <payment_hash>:<preimage>"
      : undefined,
  });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (req.method === "GET" && seg[0] === "info")
      return json({ pubkey, lock_pubkey: lockPub, mints: o.mints });

    if (req.method === "POST" && seg[0] === "episodes") {
      const text = await req.text();
      const who = verifyHttpAuth(req, text);
      if (!who)
        return json({ error: "NIP-98 authorization required (bound to the request body)" }, 401);
      const b = JSON.parse(text) as {
        d: string;
        keyHex: string;
        ivHex: string;
        priceSats: number;
        free: boolean;
        cutEventId: string;
      };
      if (!/^[0-9a-f]{32}$/.test(b.keyHex) || !/^[0-9a-f]{32}$/.test(b.ivHex))
        return json({ error: "key and iv must be 16 bytes of hex" }, 400);
      if (!/^[a-z0-9][a-z0-9-]*:ep-\d{3,}$/.test(b.d))
        return json({ error: "bad episode id" }, 400);
      if (!Number.isInteger(b.priceSats) || b.priceSats < 0 || !/^[0-9a-f]{64}$/.test(b.cutEventId))
        return json({ error: "bad price or cutEventId" }, 400);
      ledger.putEpisode({
        cut_key: `${who}/${b.d}`,
        curator: who,
        d: b.d,
        key_hex: b.keyHex,
        iv_hex: b.ivHex,
        price_sats: b.priceSats,
        free: b.free ? 1 : 0,
        cut_event_id: b.cutEventId,
      });
      return json({ ok: true, cut_key: `${who}/${b.d}` }, 201);
    }

    if (seg[0] === "key" || seg[0] === "invoice") {
      const cutKey = `${seg[1]}/${seg[2]}`;
      const ep = ledger.episode(cutKey);
      if (!ep) return json({ error: "unknown episode" }, 404);

      if (seg[0] === "invoice" && req.method === "POST") {
        if (!o.ln) return json({ error: "Lightning is not configured" }, 501);
        if (ep.free || ep.price_sats === 0) return json({ error: "episode is free" }, 400);
        const inv = await o.ln.createInvoice({
          sats: ep.price_sats,
          description: `unlock ${ep.d}`,
        });
        ledger.addInvoice(inv.paymentHash, cutKey, ep.price_sats);
        return json(inv);
      }
      if (seg[0] !== "key" || req.method !== "GET") return json({ error: "not found" }, 404);

      if (ep.free || ep.price_sats === 0) return keyResponse(ep.key_hex);
      const auth = req.headers.get("authorization") ?? "";

      if (auth.startsWith("Reelstr ")) {
        return tokenOk(cutKey, auth.slice(8))
          ? keyResponse(ep.key_hex)
          : json({ ...payInfo(ep), detail: "token invalid or expired" }, 402);
      }

      if (auth.startsWith("Nutzap ")) {
        let ev: EventLike & { id: string };
        try {
          ev = JSON.parse(atob(auth.slice(7)));
        } catch {
          return json({ ...payInfo(ep), detail: "malformed nutzap" }, 402);
        }
        if (!verifySignature(ev))
          return json({ ...payInfo(ep), detail: "bad nutzap signature" }, 402);
        if (ev.tags.find((t) => t[0] === "e")?.[1] !== ep.cut_event_id)
          return json(
            { ...payInfo(ep), detail: "nutzap must reference the current episode version" },
            402,
          );
        if (ledger.db.query("select 1 from redeemed where ref = ?").get(ev.id))
          return json({ ...payInfo(ep), detail: "this nutzap was already used" }, 402);
        try {
          const z = parseNutzap(ev);
          await verifyNutzap(ev, {
            recipient: pubkey,
            lockPubkey: lockPub,
            acceptedMints: o.mints,
            minSats: ep.price_sats,
          });
          // redeeming is the real check: the mint refuses proofs that are already spent
          const got = await redeemNutzap(ev, await walletFor(z.mintUrl), lockPriv);
          ledger.db.query("insert into redeemed values (?, ?)").run(ev.id, cutKey);
          ledger.addReceipt({
            cut_key: cutKey,
            cut_event_id: ep.cut_event_id,
            msats: got * 1000,
            source: "nutzap",
            ref: ev.id,
          });
          return keyResponse(ep.key_hex, mintToken(cutKey));
        } catch (e) {
          return json({ ...payInfo(ep), detail: (e as Error).message }, 402);
        }
      }

      if (auth.startsWith("L402 ") && o.ln) {
        const [hash, preimage] = auth.slice(5).split(":");
        const inv = hash ? ledger.invoice(hash) : null;
        if (!hash || !preimage || !inv || inv.cut_key !== cutKey)
          return json({ ...payInfo(ep), detail: "unknown invoice for this episode" }, 402);
        if (paymentHashOf(preimage) !== hash)
          return json({ ...payInfo(ep), detail: "preimage does not match" }, 402);
        if (!(await o.ln.isPaid(hash)))
          return json({ ...payInfo(ep), detail: "invoice is not settled" }, 402);
        if (ledger.db.query("select 1 from redeemed where ref = ?").get(hash))
          return json({ ...payInfo(ep), detail: "this invoice was already used" }, 402);
        ledger.db.query("insert into redeemed values (?, ?)").run(hash, cutKey);
        ledger.addReceipt({
          cut_key: cutKey,
          cut_event_id: ep.cut_event_id,
          msats: inv.sats * 1000,
          source: "ln",
          ref: hash,
        });
        return keyResponse(ep.key_hex, mintToken(cutKey));
      }
      return json(payInfo(ep), 402, { "WWW-Authenticate": "Nutzap, L402" });
    }
    return json({ error: "not found" }, 404);
  }

  const srv = Bun.serve({
    port: o.port ?? 0,
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      try {
        return await handle(req);
      } catch (e) {
        return json({ error: (e as Error).message }, 500);
      }
    },
  });
  return {
    url: `http://127.0.0.1:${srv.port}`,
    port: srv.port,
    ledger,
    pubkey,
    lockPub,
    lockPriv,
    identity,
    walletFor,
    stop: () => srv.stop(true),
    decodeInvoice,
  };
}

if (import.meta.main) {
  installUrlRewrite();
  const mints = (process.env.MINTS ?? "").split(",").filter(Boolean);
  // Lightning is optional: PHOENIXD_URL + PHOENIXD_PASSWORD, or LND_URL + LND_MACAROON (hex) [+ LND_CA]
  const ln: LnBackend | undefined = process.env.PHOENIXD_URL
    ? new PhoenixdBackend(process.env.PHOENIXD_URL, process.env.PHOENIXD_PASSWORD ?? "")
    : process.env.LND_URL
      ? new LndBackend(process.env.LND_URL, process.env.LND_MACAROON ?? "", process.env.LND_CA)
      : undefined;
  const s = await createKeyServer({
    ln,
    mints,
    port: Number(process.env.PORT ?? 3400),
    ledger: openLedger(process.env.LEDGER_DB ?? "keys.db"),
  });
  console.log(`key server on ${s.url} as ${s.pubkey}, mints: ${mints.join(", ") || "(none)"}`);
}
