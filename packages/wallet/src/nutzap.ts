import { hasValidDleq, Wallet } from "@cashu/cashu-ts";
import type { EventLike, EventTemplate } from "@reelstr/protocol";
import { type CashuWallet, sum, type WireProof } from "./cashu";

export const NUTZAP_KIND = 9321;
export const NUTZAP_INFO_KIND = 10019;

const tagVal = (tags: string[][], n: string) => tags.find((t) => t[0] === n)?.[1];
/** x-only form of a 02/03-prefixed or x-only public key */
const xonly = (k: string) => (k.length === 66 ? k.slice(2) : k).toLowerCase();

/** NIP-61 kind 10019: where and how to send me nutzaps. `p2pk` is NOT the user's Nostr key. */
export function buildNutzapInfo(o: {
  p2pk: string;
  mints: string[];
  relays: string[];
  createdAt?: number;
}): EventTemplate {
  return {
    kind: NUTZAP_INFO_KIND,
    created_at: o.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ...o.relays.map((r) => ["relay", r]),
      ...o.mints.map((m) => ["mint", m, "sat"]),
      ["pubkey", o.p2pk],
    ],
    content: "",
  };
}

export function parseNutzapInfo(e: EventLike) {
  const p2pk = tagVal(e.tags, "pubkey");
  if (e.kind !== NUTZAP_INFO_KIND || !p2pk) throw new Error("not a nutzap info event");
  return {
    p2pk,
    mints: e.tags.filter((t) => t[0] === "mint").map((t) => t[1] as string),
    relays: e.tags.filter((t) => t[0] === "relay").map((t) => t[1] as string),
  };
}

export function buildNutzap(o: {
  proofs: WireProof[];
  mintUrl: string;
  /** recipient's Nostr pubkey */
  recipient: string;
  eventId?: string;
  relay?: string;
  comment?: string;
  createdAt?: number;
}): EventTemplate {
  const tags = [
    ...o.proofs.map((p) => ["proof", JSON.stringify(p)]),
    ["u", o.mintUrl],
    ["unit", "sat"],
    ["p", o.recipient],
  ];
  if (o.eventId) tags.push(["e", o.eventId, o.relay ?? ""]);
  return {
    kind: NUTZAP_KIND,
    created_at: o.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
    content: o.comment ?? "",
  };
}

export function parseNutzap(e: EventLike) {
  if (e.kind !== NUTZAP_KIND) throw new Error("not a nutzap");
  const proofs = e.tags
    .filter((t) => t[0] === "proof")
    .map((t) => JSON.parse(t[1] ?? "{}") as WireProof);
  return {
    proofs,
    mintUrl: tagVal(e.tags, "u") ?? "",
    recipient: tagVal(e.tags, "p") ?? "",
    eventId: tagVal(e.tags, "e"),
    sats: sum(proofs),
  };
}

/** Is this proof's secret a P2PK lock to `lockPubkey`? */
export function lockedTo(p: WireProof, lockPubkey: string): boolean {
  try {
    const s = JSON.parse(p.secret) as [string, { data?: string }];
    return s[0] === "P2PK" && !!s[1]?.data && xonly(s[1].data) === xonly(lockPubkey);
  } catch {
    return false;
  }
}

export interface VerifyOpts {
  /** recipient's Nostr pubkey */
  recipient: string;
  /** the P2PK key from the recipient's 10019 */
  lockPubkey: string;
  acceptedMints: string[];
  minSats: number;
}

/**
 * Offline-ish checks before accepting a nutzap: addressed to me, accepted mint, every proof
 * locked to my key, DLEQ proofs valid for that mint's keys, enough sats. This shows the mint
 * signed the proofs; only redeeming them (a swap) proves they are unspent.
 */
export async function verifyNutzap(
  e: EventLike,
  o: VerifyOpts,
): Promise<{ sats: number; mintUrl: string }> {
  const z = parseNutzap(e);
  const fail = (m: string) => {
    throw new Error(`nutzap rejected: ${m}`);
  };
  if (z.recipient !== o.recipient) fail("not addressed to this recipient");
  if (!o.acceptedMints.includes(z.mintUrl)) fail(`mint ${z.mintUrl} is not accepted`);
  if (z.proofs.length === 0) fail("no proofs");
  if (new Set(z.proofs.map((p) => p.secret)).size !== z.proofs.length) fail("duplicate proofs");
  for (const p of z.proofs) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) fail("bad proof amount");
    if (!lockedTo(p, o.lockPubkey)) fail("proof is not locked to the recipient's key");
    if (!p.dleq) fail("proof has no DLEQ");
  }
  const w = new Wallet(z.mintUrl);
  await w.loadMint();
  for (const p of z.proofs) {
    let ok = false;
    try {
      ok = hasValidDleq({ ...p, amount: p.amount } as never, w.getKeyset(p.id) as never, {
        require: true,
      });
    } catch {}
    if (!ok) fail("invalid DLEQ proof");
  }
  if (z.sats < o.minSats) fail(`${z.sats} sats is below the required ${o.minSats}`);
  return { sats: z.sats, mintUrl: z.mintUrl };
}

/** Swap a nutzap's proofs into `wallet` with the lock key. Fails if any proof is already spent. */
export async function redeemNutzap(
  e: EventLike,
  wallet: CashuWallet,
  lockPrivkey: string,
): Promise<number> {
  const z = parseNutzap(e);
  if (z.mintUrl !== wallet.mintUrl)
    throw new Error("nutzap is for a different mint than this wallet");
  return wallet.receive(z.proofs, lockPrivkey);
}
