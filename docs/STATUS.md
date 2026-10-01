# Status by requirement

How each thing was checked. Levels, strongest first:

- **real**: run against the real implementation of the thing it talks to (real Cashu mint, real Postgres, real containers, real Chrome).
- **mock-of-real**: run against a mock built from the real system's own source or spec (phoenixd, fal), so the behaviours tested are the real ones, but the live service was never contacted.
- **fake**: run against a test double I wrote, from the spec.
- **untested**: code exists, nothing exercised it.

Run: `bun run check` (lint, types, 185+ tests) and `bun run test:e2e` (7 headless-Chrome tests). Browser tests also run against the compose containers with `E2E_COMPOSE=1`. **Nothing here has touched a public relay, a real Lightning node, or real money.**

## What talks to what

| Dependency | Checked against |
| --- | --- |
| Cashu mint | **real**: Nutshell 0.21.0 (wallet, nutzaps, key server, split service, browser wallet). Also my own fast double for most unit tests. |
| Postgres | **real**: Postgres 17 in a container (full indexer suite, 16 tests). Day-to-day tests use PGlite. |
| Relay, Blossom | **real**: as built containers (podman) and as native processes. |
| Browser | **real**: Chrome (headless). WebKit/Safari: **cannot be run on this machine** (needs Ubuntu libraries). |
| Lightning | **fake** (`FakeLightning`) plus the real mint's FakeWallet. No real node, invoice settlement or routing. LNURL: mock server. |
| phoenixd | **mock-of-real**: mock reproduces its `Api.kt` behaviours (204 for unknown hash, 200 + `reason` on failure). Never run against phoenixd. |
| fal.ai (Wan 2.2) | **mock-of-real**: mock queue; auth and URL scheme checked against the `@fal-ai/client` source. Never run live. |
| Video models | A mock "model" (deterministic colour fields). No real generative model has been run. |
| Signers | NIP-07: a bridge to an out-of-page key (not a real extension). NIP-46: a bunker I wrote from the spec. **No real extension or real bunker (nsec.app etc.) was used.** |
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
| FE-7 player | Chromium: real. **Safari/iPhone: untested.** | Frames across 2 joins in Chrome: worst gap at a join is one frame period (nothing skipped). hls.js + MSE only; the iPhone ManagedMediaSource path never ran. |
| FE-8 paywall | real browser, real mint | Unlock tap to playing **277 to 320 ms** (target 3 s), local network. Daily cap tested. |
| FE-9 wallet | real browser: Cashu + NIP-60 against the real mint, balance survives reload. NWC: fake service, unit level. | |
| FE-10 credits | real browser | |
| FE-11 report, hide, warning | real browser | |
| FE-12 crew rooms | real browser | Private draft, chat, invite, release; release re-mines PoW. |
| FE-13 ratings | real browser | |
| Agents page | real browser, mock model, real mint | Commission, review, accept, nutzap. |
| Captions | real browser | WebVTT uploaded in the Desk, shown by the player with correct cue timing. Nothing *generates* captions. |

## Backend and media

| ID | Status | Notes |
| --- | --- | --- |
| BE-1 normalizer | real | Output conforms; audio is as long as video (a `loudnorm` tail-loss bug was found and fixed). 12 s clip normalizes in about 4 s. |
| BE-2 renderer | real | **2-minute episode renders in about 36 s** (target 60 s) on a 12-core machine; will be slower on a small VPS. Hash-stable. Near-silence at a join: 0.2 ms (target 20 ms). |
| BE-3 client stitching fallback | **not built** | Server render is the only path. |
| BE-4 indexer | real Postgres 17 + PGlite | Rebuild from relays alone reproduces every table. |
| BE-5 web of trust | real | Seeded spam test under 5%. |
| BE-6 key server | real mint (nutzap), fake Lightning (L402-style) | NIP-98 registration bound to the body. |
| BE-7 split service | real mint | Payouts by real nutzaps redeemed by the recipients; Lightning-address rail against a mock LNURL. Custody-gated. |
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
- **Real Lightning is untested**: settlement, routing failures, real LNURL servers, and whether small payments are worth their fees. The real mint charged 1 sat (reserve 2) on a 21 sat melt, which is roughly 5% on a micropayment.
- **No real video model has run.** A Wan 2.2 generation through fal is the first thing to try; the adapter is checked only against a mock.
- **Safari/iPhone untested**, and all measured timings are on localhost, not a 4G network.
- **Legal is not solved by code.** Custody, money transmission, India VDA tax, and likeness rules need a lawyer before the split service touches other people's money. The split service refuses to start without an explicit acknowledgement.
- **Encrypted episodes use MPEG-TS**, because ffmpeg cannot encrypt fMP4. Any paying viewer can share the key.
- **Blossom image runs Node 22**: on Node 24 it segfaulted intermittently. It is 889 MB (build tools included); slim it before shipping.
- **Not built:** replacing a scene in a live episode has no UI (publishing a new Cut version works); fiat top-up; native apps (out of scope); caption generation.
- **Not exercised:** the `mint` profile in compose (it is a dev-only FakeWallet mint; the real Nutshell is tested natively instead).
