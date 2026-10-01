# Deviations from the PRD (research-driven)

Nothing from PRD section 6 is dropped. Where the research (`docs/research.md`, 2026-09-30) showed the PRD is wrong, stale or unsupported, the build follows the evidence. Each row: what the PRD says, what is built, why.

| PRD | Built | Why |
| --- | --- | --- |
| Scene = kind 22 (regular) | Scene = **kind 34236** (NIP-71 addressable short video), `d` = SHA-256 of the normalized video blob. Immutable by convention: an edit is a new blob, hence a new `d`. Cuts pin by event id **and** blob hash. | Divine and Flare publish addressable kinds; `a` coordinates are stable; regular kinds are only referenceable by `e` id. `d = blob hash` keeps addressable events effectively immutable. |
| Story/Cut/Series/Payout kinds TBD | Story 31810, Cut 31811, Series 31812 (addressable), Payout 9810 (regular). All in `packages/protocol/src/kinds.ts`. | Free in the NIPs README as of 2026-09-27; unregistered, re-check before the NIP PR. |
| Series mirrored as NIP-51 30005 | Deferred until rendered episodes are published as NIP-71 video events (media phase). | 30005 lists videos, and a Series lists Cuts. |
| AES-128 HLS = paywall | Built, documented as **leak-tolerant**. One paying viewer can share the key. DRM hook is an interface stub. | The key is handed to the client in the clear; segments are public Blossom blobs. |
| Nutzap = verifiable receipt | Key server verifies DLEQ **and** queries the mint for spent state (NUT-07) before releasing a key. Lightning preimage path also supported. | NIP-61 is draft; a signed token is not proof of spend. |
| NIP-90 generation agents | Plain signed request/response behind an adapter; NIP-90 adapter optional. | NIP-90 is `unrecommended`; its DVM repo was archived 2026-09-07; no text-to-video DVM kind exists. |
| "Source Verified" re-render badge | Means pinned-container same-arch re-render or perceptual match within threshold. Protocol only exposes `manifestEligibleForVerification`. | No evidence of cross-GPU bitwise reproducibility. |
| CC-BY-SA default | Kept as the default license tag. UI and docs state it covers the human-authored layer only. | US Copyright Office Part 2; Creative Commons guidance on AI output. |
| Split service as core custodian | Non-custodial zap-split tips are the default. Custodial split service (BE-7) is built, **off by default**, self-hostable. | FinCEN custody line; legal question unresolved. |
| Client-side stitching of scenes for playback | Server-rendered continuous HLS per episode is the main path; MSE stitching is the fallback (BE-3). | hls.js #7680; per-clip AAC priming gaps (21-44 ms). |
| Open-weight default model | Wan 2.2 (Apache-2.0). LTX-2.x behind a revenue-cap warning. MiniMax H3 excluded. | License terms verified against primary sources. |
| cashu-ts 5.0.0-rc.11 | cashu-ts 4.11.0 (npm `latest`) until 5.0 is stable. | RC needed spec changes against current Nutshell. |

## Media pipeline choices

- **Audio joins are a short fade (8 ms out, 8 ms in), not an overlapping crossfade, and not the PRD's ~80 ms.** An overlap shortens the audio and desyncs it from the hard video cut. The PRD asks for both an ~80 ms crossfade (BE-2) and an audio gap of at most 20 ms (NFR); an 80 ms dip measured 85 ms of near-silence, so the measurable NFR won.
- **Audio is cut sample-exactly in code, not with ffmpeg's `concat`/`atrim`.** Measured: the concat filter sequenced whatever each segment decoded to and lost ~80 ms per join (0.17 s over 2 scenes), which would drift lipsync by half a second in a 10-scene episode. Each scene is now decoded to raw float PCM, cut or zero-padded to exactly `(out-in) * 48000` samples, faded and appended. Trims are snapped to the 30 fps frame grid so video and audio lengths agree.
- **Encrypted episodes use MPEG-TS segments; clear episodes use CMAF fMP4.** ffmpeg 8.1's HLS muxer refuses to encrypt fMP4 ("Encrypted fmp4 not yet supported").
- **Each ladder rung is its own single-threaded ffmpeg, run in parallel.** Multi-threaded x264 produced different bytes for identical input (measured), which breaks hash-stable renditions; sliced threads did too. Parallelism comes from encoding rungs concurrently, with cheap deterministic x264 settings (`FAST_STREAM`: no B-frames, light motion search). A 2-minute episode renders in about 37 s on a 12-core machine (the first, single-process version took 94 s).
- Scene normalization uses two-pass loudnorm with `linear=true` (no dynamic compression). Output is bit-stable on the same ffmpeg build (bitexact flags, single-threaded encode), which is what makes a rendition hash reproducible.
- Audio leads video by one AAC priming frame (~21 ms) in the encoded HLS; this is encoder delay, not drift, and is tested.

## Found by building it

- **Times in signed tags are canonical decimal seconds** (`secs()`: rounded to whole milliseconds, at most 3 decimals). The builders used to write float noise like `6.755999999999999` into signed Cut tags; our own validator rejected it and an independent Python reader computed a different split. Found by the interop test, fixed in the builders.
- **Nutzaps carry an `e` tag naming the exact Cut version (unlocks) or job result (agent payment).** The key server refuses a nutzap that names a different Cut version, so a replaced Cut cannot be paid for under an old price.
- **Agent generation is plain request/response (kinds 9811 and 9812), not NIP-90.** The result carries the agent's signed Scene as a draft; the requester publishes it and pays by nutzap only on acceptance.
- **Crew rooms release by re-signing.** A draft in a NIP-29 room carries an `h` tag; release strips it and signs a fresh event (new id, same blobs) for the public relays, so the room id never leaks.
- **The split service refuses to start without `acknowledgeCustody`.** It holds viewers' money between unlock and payout.
- **Chat in a room has no defined order inside one second** (Nostr timestamps are seconds); clients sort by time then id.

## Protocol choices not in the PRD

- Cut `audio-bed` tag takes an optional 4th element: the bed's share of the creator pool in bps (default 1000). This lets a curator change the default and keeps weights recomputable.
- Payout Receipt `paid` tags carry a 5th element (`nutzap` or `ln`) naming the proof type, and `carry` tags record dust balances so `sum(paid) + sum(carry) + fee = total + priorCarry` holds (BE-7 acceptance).
- Episode weights are computed in integer milliseconds with largest-remainder rounding, so every client gets identical weights that sum to exactly 10,000.
- Validators recompute the split from the scene tags and reject declared weights that differ (clients may downgrade to a warning via `lenientWeights`).
- Signature verification runs on a clean copy of the event: `nostr-tools` caches verification on a hidden symbol that object spread copies, which would let a tampered copy pass.
