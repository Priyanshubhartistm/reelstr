import type { NostrEvent, RelayPool, Signer } from "@reelstr/nostr";
import {
  buildJobRequest,
  type JobRequestParams,
  KIND,
  parseJobResult,
  parseScene,
  validateEvent,
  validateJobRequest,
} from "@reelstr/protocol";
import { buildNutzap, type CashuWallet, parseNutzapInfo } from "@reelstr/wallet";

export interface Requester {
  signer: Signer;
  pool: RelayPool;
  relays: string[];
  /** where the delivered scene is published on acceptance */
  publishRelays?: string[];
}

/** Post a job to an agent. */
export async function requestJob(
  r: Requester,
  p: Omit<JobRequestParams, "createdAt">,
): Promise<NostrEvent> {
  const ev = await r.signer.signEvent(buildJobRequest(p));
  const v = validateJobRequest(ev);
  if (!v.ok) throw new Error(`invalid job: ${v.errors.join("; ")}`);
  await r.pool.publish(ev, r.relays);
  return ev;
}

/** Wait for the agent's result to a job. Throws if the agent reports an error, or on timeout. */
export async function awaitResult(
  r: Requester,
  jobId: string,
  agent: string,
  timeoutMs = 120_000,
): Promise<NostrEvent> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const res = await r.pool.get(r.relays, {
      kinds: [KIND.JOB_RESULT],
      authors: [agent],
      "#e": [jobId],
    });
    if (res) {
      const p = parseJobResult(res);
      if (p.status === "error") throw new Error(`agent declined or failed: ${p.content}`);
      return res;
    }
    if (Date.now() > end) throw new Error("timed out waiting for the agent");
    await new Promise((x) => setTimeout(x, 250));
  }
}

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
export async function acceptResult(
  r: Requester,
  result: NostrEvent,
  wallet: CashuWallet,
  bidSats: number,
): Promise<Accepted> {
  const p = parseJobResult(result);
  if (p.status !== "success") throw new Error("nothing to accept");
  const me = await r.signer.getPublicKey();
  if (p.requester !== me) throw new Error("this result is for someone else");
  const scene = JSON.parse(p.content) as NostrEvent;
  const v = validateEvent(scene, { verifySig: true });
  if (!v.ok) throw new Error(`delivered scene is invalid: ${v.errors.join("; ")}`);
  if (scene.id !== p.sceneId) throw new Error("result names a different scene than it contains");
  if (scene.pubkey !== result.pubkey) throw new Error("scene was not signed by the agent");
  const s = parseScene(scene);
  if (s.commissioner !== me) throw new Error("scene does not name you as commissioner");
  if (!s.gen.model?.open) throw new Error("scene was not made with an open-weight model");
  const [info] = (
    await r.pool.query(r.relays, { kinds: [KIND.NUTZAP_INFO], authors: [result.pubkey] })
  ).sort((a, b) => b.created_at - a.created_at);
  if (!info) throw new Error("agent has not published nutzap info (kind 10019)");
  const ni = parseNutzapInfo(info);
  if (!ni.mints.includes(wallet.mintUrl))
    throw new Error(
      `agent takes nutzaps at ${ni.mints.join(", ")}, your wallet is at ${wallet.mintUrl}`,
    );
  const proofs = await wallet.lockedSend(bidSats, ni.p2pk);
  const nz = await r.signer.signEvent(
    buildNutzap({
      proofs,
      mintUrl: wallet.mintUrl,
      recipient: result.pubkey,
      eventId: result.id,
      comment: "Reelstr job payment",
    }),
  );
  await r.pool.publish(scene, r.publishRelays ?? r.relays);
  await r.pool.publish(nz, [...new Set([...ni.relays, ...r.relays])]);
  return { scene, nutzap: nz, paidSats: bidSats };
}
