import { LocalSigner } from "@reelstr/nostr";
import type { CashuWallet } from "./cashu";
import { buildNutzap } from "./nutzap";

export interface KeyTerms {
  price_sats: number;
  cut_event_id: string;
  nutzap: { recipient: string; lock_pubkey: string; mints: string[]; e: string };
  lightning?: string;
}

export type Unlock = { kind: "free" } | { kind: "token"; token: string; paidSats: number };

/** Daily spending cap (FE-8). Storage is injected so it works in a browser or in tests. */
export class SpendGuard {
  constructor(
    private readonly store: { get(k: string): string | null; set(k: string, v: string): void },
    readonly capSats = 500,
    private readonly today = () => new Date().toISOString().slice(0, 10),
  ) {}
  spent(): number {
    const v = JSON.parse(this.store.get("reelstr.spend") ?? "{}") as {
      day?: string;
      sats?: number;
    };
    return v.day === this.today() ? (v.sats ?? 0) : 0;
  }
  check(sats: number) {
    if (this.spent() + sats > this.capSats)
      throw new Error(
        `daily spending cap of ${this.capSats} sats would be exceeded (${this.spent()} spent today)`,
      );
  }
  record(sats: number) {
    this.store.set(
      "reelstr.spend",
      JSON.stringify({ day: this.today(), sats: this.spent() + sats }),
    );
  }
}

async function terms(res: Response): Promise<KeyTerms> {
  return (await res.json()) as KeyTerms;
}

/**
 * Get the right to play an episode. Returns `free` if the key server hands the key out, or a
 * token after paying. Nothing is spent unless the terms check out and the cap allows it.
 */
export async function unlockWithNutzap(o: {
  keyUrl: string;
  wallet: CashuWallet;
  guard?: SpendGuard;
  /** price the UI showed the user; refuse if the server now asks for more */
  maxSats?: number;
}): Promise<Unlock> {
  const first = await fetch(o.keyUrl);
  if (first.ok) return { kind: "free" };
  if (first.status !== 402) throw new Error(`key server answered ${first.status}`);
  const t = await terms(first);
  if (o.maxSats !== undefined && t.price_sats > o.maxSats)
    throw new Error(`price is now ${t.price_sats} sats, more than the ${o.maxSats} you agreed to`);
  if (!t.nutzap.mints.includes(o.wallet.mintUrl))
    throw new Error(
      `this episode is sold at ${t.nutzap.mints.join(", ")}; your wallet is at ${o.wallet.mintUrl}`,
    );
  o.guard?.check(t.price_sats);
  if (o.wallet.balance() < t.price_sats)
    throw new Error(`balance ${o.wallet.balance()} sats is below the price of ${t.price_sats}`);
  const proofs = await o.wallet.lockedSend(t.price_sats, t.nutzap.lock_pubkey);
  // an ephemeral key signs the nutzap: it goes only to the key server and needs no identity
  const ev = await LocalSigner.generate().signEvent(
    buildNutzap({
      proofs,
      mintUrl: o.wallet.mintUrl,
      recipient: t.nutzap.recipient,
      eventId: t.nutzap.e,
    }),
  );
  const paid = await fetch(o.keyUrl, {
    headers: { Authorization: `Nutzap ${btoa(JSON.stringify(ev))}` },
  });
  if (!paid.ok) {
    const detail = ((await paid.json().catch(() => ({}))) as { detail?: string }).detail;
    throw new Error(
      `payment was not accepted${detail ? `: ${detail}` : ""} (the ${t.price_sats} sats may need recovering from the nutzap)`,
    );
  }
  o.guard?.record(t.price_sats);
  const token = paid.headers.get("x-reelstr-token");
  if (!token) throw new Error("key server accepted payment but sent no token");
  return { kind: "token", token, paidSats: t.price_sats };
}

/** Same, paying a Lightning invoice through any payer (NWC, an external wallet prompt, ...). */
export async function unlockWithLightning(o: {
  keyUrl: string;
  invoiceUrl: string;
  pay: (invoice: string, sats: number) => Promise<{ preimage: string }>;
  guard?: SpendGuard;
  maxSats?: number;
}): Promise<Unlock> {
  const first = await fetch(o.keyUrl);
  if (first.ok) return { kind: "free" };
  if (first.status !== 402) throw new Error(`key server answered ${first.status}`);
  const t = await terms(first);
  if (o.maxSats !== undefined && t.price_sats > o.maxSats)
    throw new Error(`price is now ${t.price_sats} sats, more than the ${o.maxSats} you agreed to`);
  o.guard?.check(t.price_sats);
  const inv = await fetch(o.invoiceUrl, { method: "POST" });
  if (!inv.ok) throw new Error(`could not get an invoice: ${inv.status}`);
  const { invoice, paymentHash } = (await inv.json()) as { invoice: string; paymentHash: string };
  const { preimage } = await o.pay(invoice, t.price_sats);
  const paid = await fetch(o.keyUrl, {
    headers: { Authorization: `L402 ${paymentHash}:${preimage}` },
  });
  if (!paid.ok) throw new Error(`payment was not accepted (${paid.status})`);
  o.guard?.record(t.price_sats);
  const token = paid.headers.get("x-reelstr-token");
  if (!token) throw new Error("key server accepted payment but sent no token");
  return { kind: "token", token, paidSats: t.price_sats };
}

export const keyHeaders = (u: Unlock): Record<string, string> | undefined =>
  u.kind === "token" ? { Authorization: `Reelstr ${u.token}` } : undefined;
