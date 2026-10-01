import type { EventTemplate } from "@reelstr/protocol";
import { getEventHash } from "nostr-tools/pure";

/** Leading zero bits of a hex id (NIP-13 difficulty). */
export function leadingZeroBits(hex: string): number {
  let bits = 0;
  for (const ch of hex) {
    const n = Number.parseInt(ch, 16);
    if (n === 0) {
      bits += 4;
      continue;
    }
    return bits + Math.clz32(n) - 28;
  }
  return bits;
}

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * NIP-13: add a nonce tag until the id has `bits` leading zero bits. Do this before signing.
 * Mining yields to the event loop every few thousand tries so a browser tab (or a Node process)
 * keeps painting and answering WebSocket pings while it works; nostr-tools' synchronous miner froze
 * the process for the whole search, long enough for a relay to drop the connection.
 * Expected work is 2^bits hashes.
 */
export async function withPow(
  t: EventTemplate,
  bits: number,
  pubkey: string,
): Promise<EventTemplate> {
  if (bits <= 0) return t;
  const base = t.tags.filter((x) => x[0] !== "nonce"); // a stale nonce would not count for a new id
  for (let nonce = 0; ; nonce++) {
    const tags = [...base, ["nonce", String(nonce), String(bits)]];
    const id = getEventHash({ ...t, tags, pubkey });
    if (leadingZeroBits(id) >= bits)
      return { kind: t.kind, created_at: t.created_at, tags, content: t.content };
    if (nonce % 2000 === 1999) await yieldToLoop();
  }
}
