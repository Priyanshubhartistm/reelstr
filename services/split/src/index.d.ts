import type { Ledger, LnBackend } from "@reelstr/keys";
import type { RelayPool, Signer } from "@reelstr/nostr";
import { type CashuWallet } from "@reelstr/wallet";
export interface SplitOpts {
  /**
   * This service holds viewers' money between unlock and payout, which can make its operator a
   * money transmitter. It refuses to run until the operator says they have taken that on.
   */
  acknowledgeCustody: boolean;
  ledger: Ledger;
  pool: RelayPool;
  relays: string[];
  /** signs nutzaps and payout receipts */
  identity: Signer;
  /** mints the service holds funds at */
  mints: string[];
  walletFor: (mint: string) => Promise<CashuWallet>;
  ln?: LnBackend;
  lnurl?: {
    fetch?: typeof fetch;
    urlFor?: (lud16: string) => string;
  };
  feeMsats?: (totalMsats: number) => number;
  dustMsats?: number;
}
export interface PaidRow {
  pubkey: string;
  msats: number;
  proof: string;
  proofType: "nutzap" | "ln";
}
export interface Batch {
  cutEventId: string;
  cutKey: string;
  totalMsats: number;
  priorCarryMsats: number;
  paid: PaidRow[];
  carried: {
    pubkey: string;
    msats: number;
    why: string;
  }[];
  receiptEventId?: string;
}
export interface Report {
  batches: Batch[];
  skipped: {
    cutEventId: string;
    reason: string;
  }[];
  /** receipts reserved by an earlier run that never finished: money may have moved, needs a human */
  stuck: number;
}
/**
 * Pay out everything received since the last run (BE-7). Per Cut version: split by the signed
 * weights, pay by nutzap or Lightning address, carry what cannot be paid, publish a receipt.
 */
export declare function runPayouts(o: SplitOpts): Promise<Report>;
