import { hexToBytes } from "@noble/hashes/utils.js";
import { decodeInvoice, paymentHashOf } from "@reelstr/bolt11";
import { LocalSigner, RelayPool } from "@reelstr/nostr";

export interface NwcConnection {
  walletPubkey: string;
  relay: string;
  secret: string;
  lud16?: string;
}

/** nostr+walletconnect://<wallet pubkey>?relay=…&secret=…[&lud16=…] */
export function parseNwcUri(uri: string): NwcConnection {
  const u = new URL(uri.replace(/^nostr\+walletconnect:\/\//, "https://x/"));
  const walletPubkey = uri.match(/^nostr\+walletconnect:\/\/([0-9a-f]{64})/)?.[1];
  const relay = u.searchParams.get("relay");
  const secret = u.searchParams.get("secret");
  if (!walletPubkey || !relay || !secret || !/^[0-9a-f]{64}$/.test(secret))
    throw new Error("invalid NWC connection string");
  return { walletPubkey, relay, secret, lud16: u.searchParams.get("lud16") ?? undefined };
}

export class NwcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** NIP-47 client. Every request is NIP-44 encrypted to the wallet service. */
export class NwcWallet {
  private readonly signer: LocalSigner;
  private readonly pool = new RelayPool();
  constructor(
    readonly conn: NwcConnection,
    private readonly timeoutMs = 30_000,
  ) {
    this.signer = new LocalSigner(hexToBytes(conn.secret));
  }
  static fromUri(uri: string, timeoutMs?: number) {
    return new NwcWallet(parseNwcUri(uri), timeoutMs);
  }

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const me = await this.signer.getPublicKey();
    const req = await this.signer.signEvent({
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", this.conn.walletPubkey],
        ["encryption", "nip44_v2"],
      ],
      content: await this.signer.nip44Encrypt(
        this.conn.walletPubkey,
        JSON.stringify({ method, params }),
      ),
    });
    const relays = [this.conn.relay];
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close();
        reject(new NwcError("TIMEOUT", `wallet did not answer ${method} in ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      const sub = this.pool.subscribe(
        relays,
        { kinds: [23195], "#e": [req.id], authors: [this.conn.walletPubkey], "#p": [me] },
        async (e) => {
          try {
            const body = JSON.parse(
              await this.signer.nip44Decrypt(this.conn.walletPubkey, e.content),
            ) as { error?: { code: string; message: string }; result?: T };
            clearTimeout(timer);
            sub.close();
            if (body.error) reject(new NwcError(body.error.code, body.error.message));
            else resolve(body.result as T);
          } catch (err) {
            clearTimeout(timer);
            sub.close();
            reject(err);
          }
        },
      );
      // publish after subscribing so a fast answer is not missed
      setTimeout(
        () =>
          this.pool.publish(req, relays).catch((err) => {
            clearTimeout(timer);
            sub.close();
            reject(new NwcError("UNREACHABLE", (err as Error).message));
          }),
        50,
      );
    });
  }

  /** Pay an invoice. The returned preimage is checked against the invoice's payment hash. */
  async payInvoice(invoice: string, expectSats?: number): Promise<{ preimage: string }> {
    const inv = decodeInvoice(invoice);
    if (expectSats !== undefined && inv.sats !== expectSats)
      throw new Error(`invoice is for ${inv.sats} sats, expected ${expectSats}`);
    const r = await this.call<{ preimage: string }>("pay_invoice", { invoice });
    if (!r?.preimage || paymentHashOf(r.preimage) !== inv.paymentHash)
      throw new NwcError(
        "BAD_PREIMAGE",
        "wallet returned a preimage that does not match the invoice",
      );
    return { preimage: r.preimage };
  }

  async getBalanceSats(): Promise<number> {
    const r = await this.call<{ balance: number }>("get_balance", {});
    return Math.floor(r.balance / 1000);
  }

  async makeInvoice(
    sats: number,
    description = "",
  ): Promise<{ invoice: string; paymentHash: string }> {
    const r = await this.call<{ invoice: string; payment_hash: string }>("make_invoice", {
      amount: sats * 1000,
      description,
    });
    const inv = decodeInvoice(r.invoice);
    if (inv.sats !== sats)
      throw new NwcError("BAD_INVOICE", `wallet made a ${inv.sats} sat invoice, asked for ${sats}`);
    return { invoice: r.invoice, paymentHash: inv.paymentHash };
  }

  close() {
    this.pool.close([this.conn.relay]);
  }
}
