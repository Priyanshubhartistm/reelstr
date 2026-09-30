import { bytesToHex } from "@noble/hashes/utils.js";
import { LocalSigner, RelayPool } from "@reelstr/nostr";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { FakeLightning } from "./fake-ln";

/** A NIP-47 wallet service for tests, backed by FakeLightning. Speaks NIP-44 like real ones. */
export async function startFakeNwc(o: {
  relay: string;
  lightning: FakeLightning;
  balanceSats: number;
  failPayments?: boolean;
}) {
  const svcKey = generateSecretKey();
  const svc = new LocalSigner(svcKey);
  const svcPub = getPublicKey(svcKey);
  const clientSecret = generateSecretKey();
  const clientPub = getPublicKey(clientSecret);
  const pool = new RelayPool();
  const state = {
    balanceMsats: o.balanceSats * 1000,
    requests: [] as { method: string; params: Record<string, unknown> }[],
  };

  const reply = async (reqId: string, body: unknown) => {
    const ev = await svc.signEvent({
      kind: 23195,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", reqId],
        ["p", clientPub],
      ],
      content: await svc.nip44Encrypt(clientPub, JSON.stringify(body)),
    });
    await pool.publish(ev, [o.relay]);
  };

  const sub = pool.subscribe(
    [o.relay],
    { kinds: [23194], "#p": [svcPub], since: Math.floor(Date.now() / 1000) - 5 },
    async (e) => {
      try {
        const req = JSON.parse(await svc.nip44Decrypt(e.pubkey, e.content)) as {
          method: string;
          params: Record<string, unknown>;
        };
        state.requests.push(req);
        if (req.method === "pay_invoice") {
          if (o.failPayments)
            return await reply(e.id, {
              result_type: "pay_invoice",
              error: { code: "PAYMENT_FAILED", message: "no route" },
            });
          const { preimage, sats } = o.lightning.pay(String(req.params.invoice));
          if (state.balanceMsats < sats * 1000)
            return await reply(e.id, {
              result_type: "pay_invoice",
              error: { code: "INSUFFICIENT_BALANCE", message: "low balance" },
            });
          state.balanceMsats -= sats * 1000;
          return await reply(e.id, { result_type: "pay_invoice", result: { preimage } });
        }
        if (req.method === "get_balance")
          return await reply(e.id, {
            result_type: "get_balance",
            result: { balance: state.balanceMsats },
          });
        if (req.method === "make_invoice") {
          const sats = Math.floor(Number(req.params.amount) / 1000);
          const inv = o.lightning.createInvoice({
            sats,
            description: String(req.params.description ?? ""),
          });
          return await reply(e.id, {
            result_type: "make_invoice",
            result: { invoice: inv.invoice, payment_hash: inv.paymentHash },
          });
        }
        await reply(e.id, {
          result_type: req.method,
          error: { code: "NOT_IMPLEMENTED", message: req.method },
        });
      } catch (err) {
        await reply(e.id, {
          result_type: "error",
          error: { code: "INTERNAL", message: (err as Error).message },
        }).catch(() => {});
      }
    },
  );
  await Bun.sleep(300); // let the subscription settle

  return {
    uri: `nostr+walletconnect://${svcPub}?relay=${encodeURIComponent(o.relay)}&secret=${bytesToHex(clientSecret)}`,
    state,
    stop: () => {
      sub.close();
      pool.close([o.relay]);
    },
  };
}
