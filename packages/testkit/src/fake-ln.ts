import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { decodeInvoice, encodeInvoice, paymentHashOf } from "@reelstr/bolt11";

interface Entry {
  sats: number;
  preimage: string;
  description: string;
  paid: boolean;
}

/**
 * A fake Lightning network for tests: makes real BOLT11 invoices and releases the preimage only
 * when the invoice is paid, so anything that verifies `sha256(preimage) == payment_hash` is
 * exercised for real. One instance is shared by the fake mint, the fake NWC wallet and the key server.
 */
export class FakeLightning {
  private readonly nodeKey = randomBytes(32);
  private readonly entries = new Map<string, Entry>();
  /** every payment made through `pay`, in order */
  readonly payments: { invoice: string; sats: number; preimage: string }[] = [];

  createInvoice(o: { sats: number; description?: string; expirySec?: number }) {
    const preimage = bytesToHex(randomBytes(32));
    const paymentHash = paymentHashOf(preimage);
    const description = o.description ?? "reelstr";
    this.entries.set(paymentHash, { sats: o.sats, preimage, description, paid: false });
    const invoice = encodeInvoice({
      sats: o.sats,
      paymentHash,
      nodeKey: this.nodeKey,
      description,
      expirySec: o.expirySec,
    });
    return { invoice, paymentHash };
  }

  isPaid(paymentHash: string) {
    return this.entries.get(paymentHash)?.paid ?? false;
  }

  /** Pay an invoice this fake network issued. Returns the preimage; throws on unknown or already-paid. */
  pay(invoice: string): { preimage: string; sats: number } {
    const d = decodeInvoice(invoice);
    const e = this.entries.get(d.paymentHash);
    if (!e) throw new Error("no route: unknown invoice");
    if (e.paid) throw new Error("invoice already paid");
    e.paid = true;
    this.payments.push({ invoice, sats: e.sats, preimage: e.preimage });
    return { preimage: e.preimage, sats: e.sats };
  }

  /** Mark an invoice paid without a payer (used by the fake mint's auto-paid mint quotes). */
  settle(paymentHash: string) {
    const e = this.entries.get(paymentHash);
    if (e) e.paid = true;
  }
}
