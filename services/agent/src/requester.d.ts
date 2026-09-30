import type { NostrEvent, RelayPool, Signer } from "@reelstr/nostr";
import { type JobRequestParams } from "@reelstr/protocol";
import { type CashuWallet } from "@reelstr/wallet";
export interface Requester {
  signer: Signer;
  pool: RelayPool;
  relays: string[];
  /** where the delivered scene is published on acceptance */
  publishRelays?: string[];
}
/** Post a job to an agent. */
export declare function requestJob(
  r: Requester,
  p: Omit<JobRequestParams, "createdAt">,
): Promise<NostrEvent>;
/** Wait for the agent's result to a job. Throws if the agent reports an error, or on timeout. */
export declare function awaitResult(
  r: Requester,
  jobId: string,
  agent: string,
  timeoutMs?: number,
): Promise<NostrEvent>;
export interface Accepted {
  scene: NostrEvent;
  nutzap: NostrEvent;
  paidSats: number;
}
/**
 * Accept a delivery: check the scene really came from the agent and names us as commissioner,
 * publish it, and pay the bid by nutzap (PY-4: no escrow, pay on acceptance). Nothing is paid or
 * published if the delivery does not check out.
 */
export declare function acceptResult(
  r: Requester,
  result: NostrEvent,
  wallet: CashuWallet,
  bidSats: number,
): Promise<Accepted>;
