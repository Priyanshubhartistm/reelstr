import { hexToBytes } from "@noble/hashes/utils.js";
import type { EventTemplate } from "@reelstr/protocol";
import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";
import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";

/** One interface for all three login paths (FE-1). No private key ever leaves the signer. */
export interface Signer {
  readonly kind: "local" | "nip07" | "nip46";
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<NostrEvent>;
  /** NIP-44 v2, needed by NIP-60 wallet storage and NIP-47 wallet connect */
  nip44Encrypt(peer: string, plaintext: string): Promise<string>;
  nip44Decrypt(peer: string, ciphertext: string): Promise<string>;
  close?(): Promise<void>;
}

export class LocalSigner implements Signer {
  readonly kind = "local" as const;
  constructor(private readonly sk: Uint8Array) {}

  /** New key for someone without a signer; the UI must show backup() and make them confirm it. */
  static generate(): LocalSigner {
    return new LocalSigner(generateSecretKey());
  }
  static fromNsec(nsec: string): LocalSigner {
    const d = nip19.decode(nsec);
    if (d.type !== "nsec") throw new Error("not an nsec");
    return new LocalSigner(d.data);
  }
  /** The only place the secret is exposed: an explicit user-facing backup action. */
  backup(): string {
    return nip19.nsecEncode(this.sk);
  }
  async getPublicKey() {
    return getPublicKey(this.sk);
  }
  async signEvent(t: EventTemplate) {
    return finalizeEvent(t, this.sk);
  }
  async nip44Encrypt(peer: string, plaintext: string) {
    return nip44.encrypt(plaintext, nip44.getConversationKey(this.sk, peer));
  }
  async nip44Decrypt(peer: string, ciphertext: string) {
    return nip44.decrypt(ciphertext, nip44.getConversationKey(this.sk, peer));
  }
}

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<NostrEvent>;
  nip44?: {
    encrypt(peer: string, plaintext: string): Promise<string>;
    decrypt(peer: string, ciphertext: string): Promise<string>;
  };
}

export class Nip07Signer implements Signer {
  readonly kind = "nip07" as const;
  constructor(private readonly ext: Nip07 = (globalThis as { nostr?: Nip07 }).nostr as Nip07) {
    if (!this.ext) throw new Error("no NIP-07 extension (window.nostr) found");
  }
  getPublicKey() {
    return this.ext.getPublicKey();
  }
  signEvent(t: EventTemplate) {
    return this.ext.signEvent(t);
  }
  nip44Encrypt(peer: string, plaintext: string) {
    if (!this.ext.nip44) throw new Error("this extension does not support NIP-44");
    return this.ext.nip44.encrypt(peer, plaintext);
  }
  nip44Decrypt(peer: string, ciphertext: string) {
    if (!this.ext.nip44) throw new Error("this extension does not support NIP-44");
    return this.ext.nip44.decrypt(peer, ciphertext);
  }
}

/** NIP-46 remote signer. `input` is a bunker:// URL or a NIP-05 identifier. */
export class Nip46Signer implements Signer {
  readonly kind = "nip46" as const;
  private constructor(private readonly bunker: BunkerSigner) {}

  /** `clientKey` is the ephemeral app key used to talk to the bunker, not the user's key. */
  static async connect(input: string, clientKey: Uint8Array = generateSecretKey()) {
    const pointer = await parseBunkerInput(input);
    if (!pointer) throw new Error("invalid bunker input");
    const bunker = BunkerSigner.fromBunker(clientKey, pointer);
    await bunker.connect();
    return new Nip46Signer(bunker);
  }
  getPublicKey() {
    return this.bunker.getPublicKey();
  }
  signEvent(t: EventTemplate) {
    return this.bunker.signEvent(t);
  }
  nip44Encrypt(peer: string, plaintext: string) {
    return this.bunker.nip44Encrypt(peer, plaintext);
  }
  nip44Decrypt(peer: string, ciphertext: string) {
    return this.bunker.nip44Decrypt(peer, ciphertext);
  }
  close() {
    return this.bunker.close();
  }
}

/**
 * A secret key from whatever a person pastes: `nsec1…`, 64 hex characters, with stray spaces, line
 * breaks, quotes or a `nostr:` prefix. Throws an Error whose message says what is wrong in plain words.
 */
export function parseSecretKey(input: string): LocalSigner {
  const s = input
    .replace(/\s+/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^nostr:/i, "");
  if (!s) throw new Error("Paste your secret key first. It starts with nsec1.");
  if (/^[0-9a-f]{64}$/i.test(s)) return new LocalSigner(hexToBytes(s.toLowerCase()));
  if (/^npub1/i.test(s))
    throw new Error(
      "That is a public key (npub). Signing in needs your secret key, which starts with nsec1.",
    );
  if (/^nsec1/i.test(s)) {
    try {
      return LocalSigner.fromNsec(s.toLowerCase());
    } catch {
      throw new Error(
        `That nsec is not valid: it has ${s.length} characters and a secret key has 63. A character may be missing or wrong, so copy it again.`,
      );
    }
  }
  throw new Error(
    `That does not look like a secret key: it has ${s.length} characters and starts with "${s.slice(0, 5)}". A secret key starts with nsec1 and has 63 characters.`,
  );
}
