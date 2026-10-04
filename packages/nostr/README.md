# @reelstr/nostr

Nostr building blocks: signers (local key, NIP-07 extension, NIP-46 bunker), a relay pool that retries and reports per relay, public key parsing, and proof-of-work mining.

**Main exports:** `RelayPool`, `LocalSigner`, `Nip07Signer`, `Nip46Signer`, `withPow`, `parsePubkey`.

**Test:** `bun test packages/nostr`.
