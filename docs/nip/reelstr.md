NIP-XX (draft v0): Reelstr serial video
=======================================

`draft` `optional`

Serial micro-drama on Nostr: forkable scenes, curator-assembled episodes, declared payment splits. This document is the contract implemented by `@reelstr/protocol`; fixtures live in `packages/protocol/fixtures`. Kind numbers are proposed here and are finalized when the NIP is submitted.

| Event | Kind | Replaceable | Signed by |
| --- | --- | --- | --- |
| Scene | 34236 (NIP-71 addressable short video) | yes by `d`, but `d` is the blob hash so an edit is a new scene | creator or agent |
| Story | 31810 | addressable | creator |
| Episode Cut | 31811 | addressable | curator |
| Series | 31812 | addressable | curator |
| Payout Receipt | 9810 | regular | split service |

## Scene

NIP-71 addressable short video plus:

- `d`: SHA-256 (hex) of the normalized video blob. Must equal the video `imeta` `x`.
- `imeta` (video): `url`, `x`, `m video/mp4`, `dim 1080x1920`, `duration` (seconds, 0 < d <= 20, target 10-15), optional `fallback`.
- `imeta` (audio, optional): `m audio/*`, `x`, `l <lang> ISO-639-1 ov` per NIP-71.
- `imeta` with `variant original`: the un-normalized upload.
- `["a", "31810:<pubkey>:<story-d>", <relay>, "root"]` required.
- `["e", <parent event id>, <relay>, "parent"]` at most one; absent on a story's first scene.
- `["license", <SPDX id>]` required; default `CC-BY-SA-4.0`. Clients MUST NOT offer Fork on licenses that are not fork-friendly.
- `["gen", "model", <name>, "open"|"closed"]`, `["gen", "seed", <n>]`, `["gen", "ref", <sha256>]`, `["gen", "lora", <sha256>]`.
- `["p", <pubkey>, <relay>, "commissioner"]`: the human who commissioned an agent. When present the commissioner is the payee for this scene; otherwise the author is.
- `["t", "reelstr"]` required.

`content` is the prompt, description or dialogue.

## Story

`d` slug, `title`, `license`, optional `style`, `["cast", name, refSha256, description]`, `r` relays, `t reelstr`; `content` is the logline.

## Episode Cut

- `d`: `<series-slug>:ep-NNN`, `episode` the same number, `title`; `content` synopsis.
- `["a", "31812:<curator>:<series-slug>", <relay>]`: the Series, owned by the same curator.
- `["scene", <scene event id>, <blob sha256>, <in s>, <out s>, <payee pubkey>]`, repeated. A Cut pins by id and hash; trims are decimal seconds with at most 3 decimals.
- `["audio-bed", <sha256>, <payee>, <pool bps, optional, default 1000>]`.
- `imeta` with `m application/x-mpegURL` for the rendered HLS (optional).
- `["price", <integer>, "sat"]`.
- `["zap", <pubkey>, <relay>, <weight>, <role>]` per NIP-57 Appendix G with integer weights summing to 10,000 and role in `creator|audio|curator|host`.

Weights are computed, not chosen: let `pool = 10000 - curator - host`; the audio bed takes `floor(pool * bedBps / 10000)`; the rest is split across payees by trimmed milliseconds using largest-remainder rounding (ties by first appearance). Clients recompute and reject or warn on mismatch.

## Series

`d` slug, `title`, `image`, ordered `a` tags to Cuts (`31811:<curator>:<slug>:ep-NNN`), `["free", <n>]`, `r` relays, `t reelstr`; `content` is the synopsis.

## Payout Receipt

`["e", <cut event id>]`, `["a", <cut coordinate>]`, `["period", start, end]`, `["total", msats]`, `["fee", msats]`, a copy of the `zap` tags paid against, one `["paid", <pubkey>, <msats>, <proof>, "nutzap"|"ln"]` per recipient (proof is a nutzap event id or a Lightning preimage), and `["carry", <pubkey>, <msats>]` for balances below 21,000 msats. Invariant: `sum(paid) + sum(carry) + fee = total + priorCarry`. NIP-57 zap receipts alone are not proof of payment and are not relied on.
