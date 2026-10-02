# Pull request text for nostr-protocol/nips

**Title:** NIP-XX: Reelstr, forkable short scenes, curated episodes and signed revenue splits

**Body**

This adds a NIP for a micro-drama format built on existing pieces: NIP-71 addressable short videos for scenes, Blossom for blobs, NIP-57 `zap` weights for splits, NIP-61 nutzaps and NIP-98 for payment and key release, NIP-32 for ratings and verification labels.

New kinds (all unclaimed in the kinds table as of 2026-10-02, re-checked before opening this PR):

| Kind | Name | Type |
| --- | --- | --- |
| 31810 | Story | addressable |
| 31811 | Cut (an episode: ordered scene references with trims, price, and the split) | addressable |
| 31812 | Series | addressable |
| 9810 | Payout receipt | regular |
| 9811 / 9812 | Generation job request / result | regular |

What it specifies:
- A Scene is a NIP-71 kind 34236 event whose `d` tag is the SHA-256 of the normalized video blob, so it is immutable by convention.
- A Cut pins each scene by event id and blob hash, and declares integer weights that sum to 10,000, computed from seconds used, so anyone can recompute the split.
- A Payout receipt lists what was paid to whom with a proof (nutzap event id or Lightning preimage).
- Optional generation manifests (model, seed, references) make open-weight scenes re-renderable, and a NIP-32 label records a verifier's verdict.

Implementation status: a reference relay, indexer, media pipeline, wallet and two web clients exist (https://github.com/Priyanshubhartistm/reelstr), and an independent Python reader recomputes splits from raw events. It has not been tested against a second real client, which is the main open item. See `docs/STATUS.md` in that repository for exactly what was and was not verified.
