# Verification report

How Reelstr was tested, and what it was tested against.

Run it yourself: `bun run check` (lint, types, 215 unit tests) and `bun run test:e2e` (19 headless-browser tests). The browser tests also run against the compose containers with `E2E_COMPOSE=1`; start from fresh volumes (`podman-compose -p reelstr down -v`), because the tests expect a relay with no earlier stories. Unit tests use fast in-process doubles; the integration and browser suites use the real systems listed below.

## Tested against

| Dependency | Verified with |
| --- | --- |
| Cashu mint | Nutshell 0.21.0: wallet, nutzaps, key server, split service and browser wallet |
| Postgres | Postgres 17 in a container (full indexer suite, 16 tests); PGlite for day-to-day runs |
| Relay, Blossom | Built containers (podman) and native processes |
| Browsers | Chrome (headless) and WebKit (Playwright's build in a container, `infra/webkit`): the viewer path (browse, play, top up, unlock, Source Verified) passes in both |
| Testnet mode | Built with `VITE_TESTNET=1` (the local demo and the live site): an orange "Testnet" badge, a faucet (500 test sats per click, a short wait between claims), a faucet button on the paywall, and a four-step guide. The sats come from a test Cashu mint, so they are free and carry no value |
| Network conditions | Chrome DevTools throttling (`NETWORK=4g\|slow-4g\|3g bun demo/src/smoke.ts`). First frame after tapping an episode: unthrottled 0.9 s, 4G 2.2 s, slow-4G 3.0 s, 3G 8 s. Paid unlock to playing: 0.9 s, 2.4 s, 4.1 s, 10 s. The player starts on the lowest rung and climbs. On the live site the first frame appears in about 2 s |
| Lightning | LND 0.18 on a private regtest chain (two nodes, one channel, invoices, HTLCs, preimages, routing failures): `LndBackend`, the key server's L402 unlock and the split service's Lightning-address payout. **LND on the Mutinynet public signet:** our own channels, 27 payments routed over three hops, and 5 invoices created by the key server's backend and paid between our two nodes (median 338 ms). The routing fee is a flat ~2 sats whatever the amount: 9.5% of 21 sats, 1% of 210, 0.2% of 1,000, so unlocks use ecash and Lightning handles top-ups and batched payouts |
| phoenixd | Backend included; its API behaviours (204 for an unknown payment hash, 200 with a `reason` on failure) are covered by tests built from its source |
| fal.ai (Wan 2.2) | Adapter included; the queue, auth and URL scheme follow the `@fal-ai/client` source and are covered by tests |
| Gemini API (Veo 3.1) | Adapter included, following Google's published Veo guide (`predictLongRunning`, `x-goog-api-key`, operation polling). Closed weights: the agent needs `AGENT_ALLOW_CLOSED=1`, the scene is marked closed and cannot earn Source Verified. Veo makes 4, 6 or 8 second clips and bills per second |
| Video models | The demo agent uses a built-in demo model (deterministic colour fields), so the whole flow runs offline |
| Signers | NIP-07 with the nos2x extension loaded in Chromium (the key stays in the extension, the page sees only `window.nostr`, signing prompts approved) and NIP-46 against fiatjaf's `nak bunker` (unit and browser tests) |
| BOLT11 | Decoder checked against three real invoices from the BOLT #11 spec (the signature recovers the spec's node key) |
| Public relays | A Reelstr scene (NIP-71 kind 34236) is accepted and served back by Damus, nos.lol and Primal |

## Frontend

| ID | Verified by | Notes |
| --- | --- | --- |
| FE-1 sign in | Real browser: local key, NIP-07 (nos2x), NIP-46 (nak bunker) | The key never enters the page (checked) |
| FE-2 composer | Real browser | Upload, manifest, parent, publish. End to end about 13 s for a 12 s clip (normalizing is most of it); relay publish to visible in under 1 s (target 5 s) |
| FE-3 fork / continue | Real browser | |
| FE-4 story tree | Real browser, 500 nodes | **67 to 84 ms** to all 500 nodes in the DOM (target 1 s), local network |
| FE-5 timeline editor | Real browser (trims, split, caption upload) | The preview uses two video elements; the server render is the final cut |
| FE-6 split preview | Real browser | |
| FE-7 player | Chromium and Linux WebKit | Frames across 2 joins in Chrome: the worst gap at a join is one frame period (nothing skipped). hls.js with MSE |
| FE-8 paywall | Real browser, real mint | Unlock tap to playing **277 to 320 ms** (target 3 s), local network. Daily cap tested |
| FE-9 wallet | Real browser: Cashu and NIP-60 against the real mint, balance survives reload; NWC at unit level | |
| FE-10 credits | Real browser | |
| FE-11 report, hide, warning | Real browser | |
| FE-12 crew rooms | Real browser | Private draft, chat, invite, release; release re-mines the proof of work |
| FE-13 ratings | Real browser | |
| Agents page | Real browser, demo model, real mint | Commission, review, accept, nutzap |
| US-K6 edit a published episode | Real browser | The Desk loads an episode, replaces scenes and publishes a new version. Progress and ratings are keyed by episode coordinate so they survive versions; reports and content-warning opt-ins stay per version |
| Source Verified | Real relay, demo model | The `Verifier` follows the relay, re-renders eligible scenes and publishes a signed NIP-32 label (one label, correct verifier and verdict; a doctored seed gives a mismatch via `verifyScene`). The app shows the badge only for verifiers the viewer trusts (`reelstr.verifiers` in localStorage or `VITE_VERIFIERS`). Checked end to end on the live site |
| Captions | Real browser, local speech-to-text | WebVTT upload and generation: the media service transcribes each trimmed scene locally (faster-whisper `small`, CPU, no data leaves the machine), times the cues against the episode, and the Desk shows an editable draft before it is attached. Needs `.venv-asr` (`requirements-asr.txt`). Tested end to end with synthesized speech (espeak-ng) |

## Backend and media

| ID | Verified by | Notes |
| --- | --- | --- |
| BE-1 normalizer | Real | Output conforms and the audio is as long as the video. A 12 s clip normalizes in about 4 s. Each scene also gets a JPEG poster frame |
| BE-2 renderer | Real | A **2-minute episode renders in about 36 s** (target 60 s) on a 12-core machine. Hash-stable. Near-silence at a join: 0.2 ms (target 20 ms) |
| BE-3 client stitching fallback | Real browser (Chrome) | Free episodes only (paid ones are encrypted). Plays the trimmed scenes in two video elements when the rendered HLS is unreachable; the worst join gap is **100 to 150 ms** (the HLS path is one frame) |
| BE-4 indexer | Real Postgres 17 and PGlite | Rebuilding from relays alone reproduces every table |
| BE-5 web of trust | Real | Seeded spam test under 5% |
| BE-6 key server | Real mint (nutzap), real LND on regtest (L402-style) | NIP-98 registration bound to the body |
| BE-7 split service | Real mint | Payouts by nutzaps redeemed by the recipients; the Lightning-address payout runs against a real LND node on regtest (the preimage matches the real invoice, which settles). Custody-gated |
| BE-8 mirror | Real | Plays with the origin stopped |
| Media service | Real | NIP-98 per-request auth, job ownership, rate limit, queue cap, size cap and a source-host allowlist |

## Protocol and payments

| ID | Verified by | Notes |
| --- | --- | --- |
| NP-1/2 spec, package, fixtures | Fixtures | 9 valid and 12 invalid fixtures |
| NP-3 reference relay | Native and container | Kind allowlist, proof-of-work floor and timestamp window, advertised in NIP-11 and enforced; the client mines the floor automatically |
| NP-4 crew relay | Real | |
| NP-5 generation jobs | Agent end to end with the demo model | Adapters for fal (Wan 2.2) and Gemini Veo are included |
| NP-6 agent identity | Real | Bot flag, commissioner; credits show both |
| NP-7 second reader | `interop/reader.py`, stdlib only | Verifies signatures and recomputes splits from raw events; scenes are also accepted and served by public relays |
| PY-1 zap-split tips | Unit tests with a Lightning-address test server | |
| PY-2/3 unlock and payouts | Real mint | |
| PY-4 agent payment on acceptance | Real mint | Paid within a minute; a wrong payer, an underpayment and a replay are refused |
