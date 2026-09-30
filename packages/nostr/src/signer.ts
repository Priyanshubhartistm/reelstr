import type { EventTemplate } from "@reelstr/protocol";
import * as nip19 from "nostr-tools/nip19";
import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";

/** One interface for all three login paths (FE-1). No private key ever leaves the signer. */
export interface Signer {
  readonly kind: "local" | "nip07" | "nip46";
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<NostrEvent>;
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
}

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(t: EventTemplate): Promise<NostrEvent>;
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
  close() {
    return this.bunker.close();
  }
}
