# Design decisions

The choices behind Reelstr's protocol, payments and media pipeline, with the reasoning for each.

## Protocol and payments

| Area | Decision | Reason |
| --- | --- | --- |
| Scene event | **Kind 34236** (NIP-71 addressable short video), `d` = SHA-256 of the normalized video blob. An edit is a new blob, hence a new `d`. Cuts pin by event id **and** blob hash. | Divine and Flare publish addressable kinds; `a` coordinates are stable, while regular kinds are only referenceable by `e` id. `d` = blob hash keeps addressable events effectively immutable. |
| Story, Cut, Series, Payout | Story 31810, Cut 31811, Series 31812 (addressable), Payout 9810 (regular), all in `packages/protocol/src/kinds.ts`. | Kinds 31810 to 31812 and 9810 to 9812 are not used by any registered NIP (checked 2026-10-02). |
| Series as a NIP-51 list | Added once rendered episodes are published as NIP-71 video events. | NIP-51 kind 30005 lists videos, while a Series lists Cuts. |
| Paid episodes | AES-128 HLS. The key server issues the episode key to each paying viewer, and a DRM provider can be plugged in at the key server. | HLS supports AES-128 natively; segments are public Blossom blobs, so access is controlled at the key. |
| Payment proof | The key server verifies the DLEQ proof **and** queries the mint for spent state (NUT-07) before releasing a key. A Lightning preimage path is also supported. | A signed token proves the mint issued it, not that it is unspent. |
| Generation agents | Plain signed request and result (kinds 9811 and 9812) behind an adapter; a NIP-90 adapter is optional. | There is no text-to-video DVM kind, and a plain request/result keeps the flow simple. |
| Source Verified | A pinned-container, same-architecture re-render, or a perceptual match within a threshold. The protocol exposes `manifestEligibleForVerification`. | Re-rendering is reproducible on the same stack, which is the guarantee a verifier can make. |
| Default license | CC-BY-SA-4.0. The UI and docs state that it covers the human-authored layer. | Matches US Copyright Office and Creative Commons guidance on AI output. |
| Money handling | Zap-split tips (non-custodial) are the default. The split service is built, self-hostable and **off by default**; it refuses to start without `acknowledgeCustody`. | The split service holds funds between an unlock and the payout, so enabling it is an explicit choice. |
| Playback | A server-rendered, continuous HLS stream per episode is the main path. The fallback plays trimmed scenes in two video elements (free episodes, worst join gap 100 to 150 ms). | One continuous render has no join gap, since it avoids per-clip AAC priming gaps (21 to 44 ms). |
| Default open model | Wan 2.2 (Apache-2.0). LTX-2.x sits behind a revenue-cap warning. | Open weights make Source Verified possible; license terms were checked against primary sources. |
| Cashu library | cashu-ts 4.11.0 (npm `latest`). | Stable release, compatible with the current Nutshell. |

## Protocol rules

- **Weights are computed, not chosen.** They use integer milliseconds with largest-remainder rounding, so every client gets identical weights that sum to exactly 10,000. Validators recompute the split from the scene tags and reject declared weights that differ (clients may downgrade to a warning via `lenientWeights`).
- **Times in signed tags are canonical decimal seconds** (`secs()`: whole milliseconds, at most 3 decimals), so every client computes the same split.
- **Cut `audio-bed`** takes an optional 4th element: the bed's share of the creator pool in bps (default 1000).
- **Payout receipt** `paid` tags carry a 5th element (`nutzap` or `ln`) naming the proof type, and `carry` tags record dust balances so `sum(paid) + sum(carry) + fee = total + priorCarry`.
- **Nutzaps carry an `e` tag** naming the exact Cut version (unlocks) or job result (agent payment). The key server refuses a nutzap that names a different Cut version, so a replaced Cut cannot be paid for under an old price.
- **Agent results carry the agent's signed Scene as a draft.** The requester publishes it and pays by nutzap only on acceptance.
- **Crew rooms release by re-signing.** A draft in a NIP-29 room carries an `h` tag; release strips it and signs a fresh event (new id, same blobs) for the public relays, so the room id never leaks. Release re-mines the proof of work for gated relays.
- **Chat in a room** is ordered by time then event id (Nostr timestamps are seconds).
- **Signature verification** runs on a clean copy of the event.
- **The relay advertises what it enforces.** NIP-11 carries `min_pow_difficulty` and the `created_at` window, and the client reads the proof-of-work floor and mines it automatically.
- **The indexer subscribes without `since`** and ingests idempotently, so late or backfilled events are never dropped.

## Media pipeline

- **Audio joins are a short fade** (8 ms out, 8 ms in), not an overlapping crossfade. An overlap shortens the audio and desyncs it from the hard video cut, and the short fade meets the 20 ms near-silence target.
- **Audio is cut sample-exactly in code.** Each scene is decoded to raw float PCM, cut or zero-padded to exactly `(out-in) * 48000` samples, faded and appended. Trims are snapped to the 30 fps frame grid so video and audio lengths agree.
- **Encrypted episodes use MPEG-TS segments; clear episodes use CMAF fMP4**, because ffmpeg's HLS muxer encrypts MPEG-TS.
- **Each ladder rung is its own single-threaded ffmpeg, run in parallel**, with deterministic x264 settings (`FAST_STREAM`: no B-frames, light motion search). Renditions are hash-stable, and a 2-minute episode renders in about 36 s on a 12-core machine.
- **Scene normalization** uses two-pass loudnorm with `linear=true` (no dynamic compression), then a measured static gain. Output is bit-stable on the same ffmpeg build (bitexact flags, single-threaded encode), which is what makes a rendition hash reproducible.
- **Audio leads video by one AAC priming frame** (~21 ms) in the encoded HLS; this is encoder delay, not drift.
- **Every scene gets a JPEG poster frame** at upload, included in its `imeta`.

## Media service security

Requests are NIP-98 signed and bound to URL, method and body. Jobs belong to their creator. There is a per-key rate limit, a queue cap, a request size cap and an allowlist of source hosts.

## Product decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Top-ups | A viewer tops up with any Lightning wallet through an invoice, or connects one through NWC. The "Pay by card or UPI (demo)" button is a labelled demo. | A real fiat on-ramp needs a registered business partner; invoices and NWC work today. |
| Content protection | AES-128 HLS, with a DRM hook at the key server. | DRM can be added when there is revenue to protect. |
| Video model | Both hosted routes are supported: Wan 2.2 through fal (open weights, so Source Verified works) and Veo 3.1 through the Gemini API (closed weights, marked closed and not verifiable). The agent accepts closed-model jobs only when `AGENT_ALLOW_CLOSED=1`. | Open weights are what makes verification possible; Gemini is a good choice for quality or when you already have a key. |
| Protocol submission | `docs/nip/reelstr.md` is the draft and `docs/nip/PR-DESCRIPTION.md` the pull request text, ready to submit. | Submitting under a maintainer's account is their call. |
