import * as nip19 from "nostr-tools/nip19";

/** A public key from what people paste: 64 hex characters or an `npub1…`. Null if it is neither. */
export function parsePubkey(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  try {
    const d = nip19.decode(s);
    return d.type === "npub" ? d.data : null;
  } catch {
    return null;
  }
}
