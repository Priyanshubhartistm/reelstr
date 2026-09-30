import type { EventTemplate } from "@reelstr/protocol";
import { minePow } from "nostr-tools/nip13";

/** NIP-13: add a nonce tag until the id has `bits` leading zero bits. Do this before signing. */
export function withPow(t: EventTemplate, bits: number, pubkey: string): EventTemplate {
  if (bits <= 0) return t;
  const mined = minePow({ ...t, pubkey }, bits);
  return {
    kind: mined.kind,
    created_at: mined.created_at,
    tags: mined.tags,
    content: mined.content,
  };
}
