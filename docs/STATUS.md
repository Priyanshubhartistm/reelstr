# Status by requirement

How each thing was checked. Levels, strongest first:

- **real**: run against the real implementation of the thing it talks to (real Cashu mint, real Postgres, real containers, real Chrome).
- **mock-of-real**: run against a mock built from the real system's own source or spec (phoenixd, fal), so the behaviours tested are the real ones, but the live service was never contacted.
- **fake**: run against a test double I wrote, from the spec.
- **untested**: code exists, nothing exercised it.

Run: `bun run check` (lint, types, 203 tests) and `bun run test:e2e` (19 headless-browser tests). Browser tests also run against the compose containers with `E2E_COMPOSE=1` (start from fresh volumes: `podman-compose -p reelstr down -v`, because the tests are not idempotent against a relay that kept the last run's stories). Last run: all 10 pass natively (9 against compose, run before captions), with the slim Blossom image. **Nothing here has touched a public relay, a real Lightning node, or real money.**

## What talks to what

| Dependency | Checked against |
| --- | --- |
| Cashu mint | **real**: Nutshell 0.21.0 (wallet, nutzaps, key server, split service, browser wallet). Also my own fast double for most unit tests. |
| Postgres | **real**: Postgres 17 in a container (full indexer suite, 16 tests). Day-to-day tests use PGlite. |
| Relay, Blossom | **real**: as built containers (podman) and as native processes. |
| Browser | **real**: Chrome (headless), and **real WebKit** (Playwright's build in a container, `infra/webkit`): the viewer path (browse, play, top up, unlock, Source Verified) passes. That is the WebKit engine on Linux, **not iOS Safari** (no iPhone ManagedMediaSource path, different autoplay and power rules): a real iPhone is still untested. |
| Testnet mode | Built with `VITE_TESTNET=1` (the local demo and the live site): an orange "Testnet" badge, a **faucet** (500 test sats per click, a short wait between claims), a faucet button right on the paywall, and a four-step guide. **What "testnet" means here:** the sats come from a development Cashu mint whose Lightning side is a fake that settles at once, so they are free and worth nothing. It is **not** a Bitcoin signet or testnet network. Real Lightning routing was only tested on a private regtest chain. |
| Network | **simulated** with Chrome DevTools throttling (`NETWORK=4g\|slow-4g\|3g bun demo/src/smoke.ts`). First frame after tapping an episode: unthrottled 0.9 s, 4G (70 ms, 9 Mbit/s) 2.2 s, slow-4G (150 ms, 1.6 Mbit/s) 3.0 s, 3G (300 ms, 400 kbit/s) 8 s. Paid unlock to playing: 0.9 s, 2.4 s, 4.1 s, 10 s. The player now starts on the lowest rung (it used to open on 1920p: 7.4 s on slow-4G, 25 s on 3G). A simulation: real mobile links have jitter and loss. |
| Lightning | **real LND 0.18 on a private regtest chain** (two nodes, one channel, real invoices, HTLCs, preimages, routing failures): `LndBackend`, the key server's L402 unlock, and the split service's Lightning-address payout. Everything else still uses `FakeLightning` for speed. **Not real:** mainnet, real liquidity and routing across a public graph, real fees, and phoenixd (the production target) was never run. LNURL: a mock server fronting a real node. |
| phoenixd | **mock-of-real**: mock reproduces its `Api.kt` behaviours (204 for unknown hash, 200 + `reason` on failure). Never run against phoenixd. |
| fal.ai (Wan 2.2) | **mock-of-real**: mock queue; auth and URL scheme checked against the `@fal-ai/client` source. Never run live. |
| Gemini API (Veo 3.1) | **mock-of-real**: a mock built from Google's published Veo guide (`predictLongRunning`, `x-goog-api-key`, operation polling, `generatedSamples[0].video.uri`). Never run live. Closed weights: the agent needs `AGENT_ALLOW_CLOSED=1`, the scene is marked closed and cannot earn Source Verified. Veo makes 4, 6 or 8 second clips and bills per second with no free tier. |
| Video models | A mock "model" (deterministic colour fields). No real generative model has been run. |
| Signers | **Real**: NIP-07 with the nos2x extension loaded in Chromium (key in the extension, page sees only `window.nostr`, signing prompts approved), and NIP-46 against fiatjaf\'s `nak bunker` (unit and browser). Also the earlier stand-ins. **Not tested:** phone signers (Amber), nsec.app, Alby/other extensions. |
| BOLT11 | decoder checked against three real invoices from the BOLT #11 spec (signature recovers the spec's node key) |

## Frontend

| ID | Status | Notes |
| --- | --- | --- |
| FE-1 sign in | local key: real browser; NIP-07 and NIP-46: real browser against the stand-ins above | Key never enters the page (checked). Real signers untested. |
| FE-2 composer | real browser | Upload, manifest, parent, publish. End to end takes about 13 s for a 12 s clip (normalizing is most of it); relay-publish-to-visible is under 1 s (target 5 s). |
| FE-3 fork / continue | real browser | |
| FE-4 story tree | real browser, 500 nodes | **67 to 84 ms** to all 500 nodes in the DOM (target 1 s), local network. |
| FE-5 timeline editor | real browser (trims, split, caption upload) | Preview uses two video elements and is not frame-exact; the server render is the truth. |
| FE-6 split preview | real browser | |
| FE-7 player | Chromium and Linux WebKit: real. **iPhone Safari: untested.** | Frames across 2 joins in Chrome: worst gap at a join is one frame period (nothing skipped). hls.js + MSE only; the iPhone ManagedMediaSource path never ran. |
| FE-8 paywall | real browser, real mint | Unlock tap to playing **277 to 320 ms** (target 3 s), local network. Daily cap tested. |
| FE-9 wallet | real browser: Cashu + NIP-60 against the real mint, balance survives reload. NWC: fake service, unit level. | |
| FE-10 credits | real browser | |
| FE-11 report, hide, warning | real browser | |
| FE-12 crew rooms | real browser | Private draft, chat, invite, release; release re-mines PoW. |
| FE-13 ratings | real browser | |
| Agents page | real browser, mock model, real mint | Commission, review, accept, nutzap. |
| US-K6 edit a published episode | real browser | Desk loads an episode, replaces scenes, publishes a new version. Progress and ratings are keyed by episode coordinate so they survive versions; reports and content-warning opt-ins stay per version. One early run saved progress 0 after a pause and never reproduced. Likely cause found and fixed: the player was rebuilt on any page re-render because `startAt` and `keyHeaders` were effect dependencies; it now initializes only when the source or key changes. **No test reproduces the old failure, so the fix is reasoned, not proven.** |
| Source Verified | real relay, mock model | `Verifier` follows the relay, re-renders eligible scenes, publishes a signed NIP-32 label (tested: one label, correct verifier and verdict; doctored seed gives mismatch via `verifyScene`). Studio shows the badge only for verifiers the viewer trusts (`reelstr.verifiers` in localStorage or `VITE_VERIFIERS`). No real open model has been re-rendered, and the badge is not covered by a browser test. |
| Captions | real browser, real speech-to-text | WebVTT upload, and **generation**: the media service transcribes each trimmed scene locally (faster-whisper `small`, CPU, no data leaves the machine), times cues against the episode, and the Desk shows an editable draft before it is attached. Tested end to end with synthesized speech (espeak-ng). Accuracy on real human speech, accents and music is **untested**, and synthetic speech was misheard by the smaller model ("vault" as "fault"), which is why the draft is shown for editing. Needs `.venv-asr` (`requirements-asr.txt`); the media service returns an error without it. |

## Backend and media

| ID | Status | Notes |
| --- | --- | --- |
| BE-1 normalizer | real | Output conforms; audio is as long as video (a `loudnorm` tail-loss bug was found and fixed). 12 s clip normalizes in about 4 s. |
| BE-2 renderer | real | **2-minute episode renders in about 36 s** (target 60 s) on a 12-core machine; will be slower on a small VPS. Hash-stable. Near-silence at a join: 0.2 ms (target 20 ms). |
| BE-3 client stitching fallback | real browser (Chrome) | Free episodes only (paid ones are encrypted, so there is nothing to stitch). Plays the trimmed scenes in two video elements when the rendered HLS is unreachable. Worst join gap measured **100 to 150 ms** (the HLS path is one frame). Warming the next decoder or starting early made it worse and was reverted. |
| BE-4 indexer | real Postgres 17 + PGlite | Rebuild from relays alone reproduces every table. |
| BE-5 web of trust | real | Seeded spam test under 5%. |
| BE-6 key server | real mint (nutzap), real LND on regtest (L402-style), fake Lightning in most tests | NIP-98 registration bound to the body. |
| BE-7 split service | real mint | Payouts by real nutzaps redeemed by the recipients; Lightning-address rail: mock LNURL fronting a **real LND node on regtest** (preimage matches the real invoice, which settles). Custody-gated. |
| BE-8 mirror | real | Plays with the origin stopped. |
| Media service | real | NIP-98 per-request auth, job ownership, rate limit, queue cap, size cap, SSRF allowlist. |

## Protocol and payments

| ID | Status | Notes |
| --- | --- | --- |
| NP-1/2 spec, package, fixtures | done | 9 valid and 12 invalid fixtures. |
| NP-3 reference relay | real (native + container) | Kind allowlist, PoW floor, timestamp window, all advertised in NIP-11 and enforced; client mines the floor automatically. |
| NP-4 crew relay | real | |
| NP-5 generation jobs | mock model | Real models never run. |
| NP-6 agent identity | real | Bot flag, commissioner, credits show both. |
| NP-7 second reader | `interop/reader.py`, stdlib only | Verifies signatures and recomputes splits; found one real bug. **No second real client exists.** |
| PY-1 zap-split tips | fake Lightning + mock LNURL | |
| PY-2/3 unlock and payouts | real mint | |
| PY-4 agent payment on acceptance | real mint | Paid within a minute; wrong payer, underpay, replay refused. |

## Known gaps and risks

- **Demand is unproven.** Fork rate and unlock conversion are the real tests; the PRD's kill signals stand.
- **Lightning on a real public network (Mutinynet signet, valueless coins): tested.** Our own LND nodes (pruned bitcoind + LND, `infra/mutinynet`) opened real channels and routed real payments. The key server's `LndBackend` created invoices, a second node paid them over a channel, and all 5 settled (median 338 ms, `demo/src/mutinynet-e2e.ts`). 28 payments to the Mutinynet faucet's node over 3 hops all succeeded; the routing fee was a flat ~2 sats whatever the size: **9.5% of 21 sats, 1.0% of 210, 0.2% of 1000**. So a 21-sat Lightning payment is not worth its fee; ecash unlocks (no routing) are, and Lightning payouts should be batched (`SPLIT_DUST_SATS`). Still untested: mainnet, real liquidity pressure, phoenixd, a real LNURL server. The earlier "5%" from a melt on a dev mint was a different number (1 sat fee on 21).
- **No real video model has run.** A Wan 2.2 generation through fal is the first thing to try; the adapter is checked only against a mock.
- **Mobile app (Capacitor, `apps/mobile`): debug APK builds, never run.** `infra/android` produced a 4.7 MB debug APK in a container (about 3 min on 1 CPU) and its bundle was checked to hold the current web build and live endpoints. No phone was connected and no emulator was run, so install, launch, video playback in the WebView and the Android back button are untested. iOS needs a Mac. Nothing is in a store.
- **Store policy is a release blocker for iOS, not a code gap.** Per `docs/research.md`, Apple guideline 3.1.1 bans unlocking content with crypto inside native apps, so an App Store build with the sats paywall would likely be rejected (web/PWA is the iOS route). Android and Google Play policy for this has not been checked.
- **Real iPhone Safari untested** (WebKit-on-Linux passes), and the 4G/3G timings are simulated throttling, not a real network.
- **Legal is not solved by code.** Custody, money transmission, India VDA tax, and likeness rules need a lawyer before the split service touches other people's money. The split service refuses to start without an explicit acknowledgement.
- **Encrypted episodes use MPEG-TS**, because ffmpeg cannot encrypt fMP4. Any paying viewer can share the key.
- **Blossom image runs Node 22**: on Node 24 it segfaulted intermittently. Multi-stage build, 411 MB (was 808); upload and fetch-by-hash checked on the built image.
- **Fiat top-up** is only a demo partner button (`VITE_FIAT_DEMO`), no real on-ramp. Native apps: see the Mobile bullet above.
- **Not exercised:** the `mint` profile in compose (it is a dev-only FakeWallet mint; the real Nutshell is tested natively instead).
