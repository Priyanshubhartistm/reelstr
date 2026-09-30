import { hashToCurve, Wallet } from "@cashu/cashu-ts";
import { decodeInvoice } from "@reelstr/bolt11";

/** Proofs in plain JSON form (amount is a number), as stored and sent inside nutzaps. */
export interface WireProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  dleq?: { e: string; s: string; r?: string };
}

export interface ProofStore {
  load(): Promise<WireProof[]>;
  save(proofs: WireProof[]): Promise<void>;
}

export class MemoryStore implements ProofStore {
  constructor(private proofs: WireProof[] = []) {}
  async load() {
    return this.proofs;
  }
  async save(p: WireProof[]) {
    this.proofs = p;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: cashu-ts Proof carries an Amount class we flatten to a number
export const toWire = (p: any): WireProof => ({
  id: p.id,
  amount: typeof p.amount === "number" ? p.amount : p.amount.toNumber(),
  secret: p.secret,
  C: p.C,
  ...(p.dleq ? { dleq: p.dleq } : {}),
});
export const sum = (ps: { amount: number }[]) => ps.reduce((a, p) => a + p.amount, 0);

/** Y = hash_to_curve(secret): how a mint names a proof in NUT-07 state checks. */
export const proofY = (secret: string) => hashToCurve(new TextEncoder().encode(secret)).toHex(true);

export async function proofStates(mintUrl: string, secrets: string[]): Promise<boolean[]> {
  const res = await fetch(`${mintUrl}/v1/checkstate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Ys: secrets.map(proofY) }),
  });
  if (!res.ok) throw new Error(`mint state check failed: ${res.status}`);
  const j = (await res.json()) as { states: { state: string }[] };
  return j.states.map((s) => s.state === "SPENT");
}

/** One mint, one wallet. The caller owns persistence through a ProofStore (NIP-60 in the apps). */
export class CashuWallet {
  private constructor(
    readonly mintUrl: string,
    readonly wallet: Wallet,
    private readonly store: ProofStore,
    private proofs: WireProof[],
  ) {}

  static async open(mintUrl: string, store: ProofStore = new MemoryStore()) {
    const wallet = new Wallet(mintUrl);
    await wallet.loadMint();
    return new CashuWallet(mintUrl, wallet, store, await store.load());
  }

  balance() {
    return sum(this.proofs);
  }
  list(): WireProof[] {
    return [...this.proofs];
  }

  private async set(p: WireProof[]) {
    this.proofs = p;
    await this.store.save(p);
  }

  /**
   * Get `sats` into the wallet: ask the mint for an invoice, let `pay` settle it (a Lightning
   * wallet, NWC, ...), then mint. The invoice amount is checked before anything is paid.
   */
  async topUp(sats: number, pay: (invoice: string) => Promise<unknown>): Promise<number> {
    const quote = await this.wallet.createMintQuoteBolt11(sats);
    const inv = decodeInvoice(quote.request);
    if (inv.sats !== sats)
      throw new Error(`mint invoice is for ${inv.sats} sats, expected ${sats}`);
    await pay(quote.request);
    for (let i = 0; i < 60; i++) {
      const q = await this.wallet.checkMintQuoteBolt11(quote.quote);
      if (q.state === "PAID") break;
      if (q.state === "ISSUED") throw new Error("quote already issued");
      await new Promise((r) => setTimeout(r, 500));
    }
    const minted = (await this.wallet.ops.mintBolt11(sats, quote.quote).run()).map(toWire);
    await this.set([...this.proofs, ...minted]);
    return this.balance();
  }

  /** Proofs locked to `pubkey` (P2PK); change stays in the wallet. Used for nutzaps. */
  async lockedSend(sats: number, pubkey: string): Promise<WireProof[]> {
    if (this.balance() < sats) throw new Error(`balance ${this.balance()} is below ${sats} sats`);
    const { keep, send } = await this.wallet.ops.send(sats, this.proofs).asP2PK({ pubkey }).run();
    await this.set(keep.map(toWire));
    return send.map(toWire);
  }

  /** Swap received proofs (optionally P2PK-locked to `privkey`) into fresh proofs we own. */
  async receive(proofs: WireProof[], privkey?: string): Promise<number> {
    const b = this.wallet.ops.receive(proofs as never);
    const got = (await (privkey ? b.privkey(privkey) : b).run()).map(toWire);
    await this.set([...this.proofs, ...got]);
    return sum(got);
  }

  /** Pay a Lightning invoice from the wallet (melt). Verifies the preimage is for the invoice. */
  async payInvoice(invoice: string): Promise<{ preimage: string; sats: number }> {
    const quote = await this.wallet.createMeltQuoteBolt11(invoice);
    const need = quote.amount.toNumber() + quote.fee_reserve.toNumber();
    if (this.balance() < need) throw new Error(`need ${need} sats, have ${this.balance()}`);
    // melt with everything we hold: the mint returns the excess as change (NUT-08)
    const { quote: paid, change } = await this.wallet.ops
      .meltBolt11(quote, this.proofs as never)
      .run();
    await this.set(change.map(toWire));
    return { preimage: paid.payment_preimage ?? "", sats: quote.amount.toNumber() };
  }

  /** Drop proofs the mint says are spent (e.g. after using the wallet from another device). */
  async prune(): Promise<number> {
    if (this.proofs.length === 0) return 0;
    const spent = await proofStates(
      this.mintUrl,
      this.proofs.map((p) => p.secret),
    );
    const live = this.proofs.filter((_, i) => !spent[i]);
    const dropped = this.proofs.length - live.length;
    if (dropped) await this.set(live);
    return dropped;
  }
}
