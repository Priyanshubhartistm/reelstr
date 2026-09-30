# Status by requirement

Legend: **tested** = automated test exercises it against real local services; **browser** = also driven in headless Chrome; **untested** = code exists, nothing exercised it; **not built**.
Last full run: `bun run check` (lint, types, tests) and `bun run test:e2e`. Everything runs locally against a Go relay, native Blossom, a fake Cashu mint and a fake Lightning backend. **Nothing has touched a public relay, a real mint or real money.**

## Frontend

| ID | Status | Notes |
| --- | --- | --- |
| FE-1 sign in (NIP-07, NIP-46, local key) | local key: browser; NIP-07 and NIP-46: untested | Extension and bunker paths are thin wrappers, never run against a real signer. |
| FE-2 scene composer | browser | Upload, manifest, parent, publish; 200 MB cap checked client-side. |
| FE-3 fork / continue | browser | Carries parent, story, license, manifest. |
| FE-4 story tree | browser (2 to 4 nodes) | The 500-node under-1 s target is not measured. |
| FE-5 timeline editor | browser (trims, split) | Preview uses two video elements and is not frame-exact; the server render is the source of truth. |
| FE-6 split preview | browser | Same math as the signed Cut. |
| FE-7 player | browser (Chromium) | hls.js, auto-next, resume. iPhone Safari / ManagedMediaSource never run. |
| FE-8 paywall sheet | browser | Nutzap unlock, daily cap. The under-3 s unlock target is not measured. |
| FE-9 wallet | browser (Cashu + NIP-60); NWC: tested, not in browser | Balance survives reload via relays. |
| FE-10 credits | browser | Seconds and shares; totals 100%. |
| FE-11 report, hide, content warning | browser | Hidden for the reporter immediately. |
| FE-12 crew rooms | browser | Chat, drafts, invite, release. |
| FE-13 ratings, reviews | browser | NIP-32 labels; average, count, review text. |

## Backend and media

| ID | Status | Notes |
| --- | --- | --- |
| BE-1 normalizer | tested | 1080x1920, 30 fps CFR, H.264 High, AAC 48k, -14 LUFS within 1 LU, bit-stable output. |
| BE-2 episode renderer | tested | Hash-stable, sample-exact audio (no drift over 8 joins), AES-128 option. The "ready in under 60 s" target is not measured. |
| BE-3 client fallback stitching | not built | Server render is the only playback path. |
| BE-4 indexer | tested | Rebuild from relays alone reproduces every table. |
| BE-5 web-of-trust | tested | Seeded spam test under 5%. |
| BE-6 key server | tested | NIP-98 registration, nutzap and L402-style unlock, replay refused. |
| BE-7 split service | tested | Dust carry, `prior_carry`, receipts validate. Custody-gated. Real mint and Lightning untested. |
| BE-8 mirror job | tested | Episode plays with the origin server stopped. |

## Protocol

| ID | Status | Notes |
| --- | --- | --- |
| NP-1 spec draft | done | `docs/nip/reelstr.md` (no PR opened). |
| NP-2 shared package and fixtures | tested | 9 valid and 12 invalid fixtures. |
| NP-3 reference relay | tested | Kind allowlist and PoW floor. |
| NP-4 crew relay | tested | Drafts never reach the public relay until released. |
| NP-5 generation jobs | tested with a mock model | Real models untested. `FalWanAdapter` has never been run. |
| NP-6 agent identity | tested | `bot` profile flag, commissioner tag, credits list agent and commissioner separately. |
| NP-7 second reader | tested | `interop/reader.py` (stdlib only) verifies signatures and recomputes splits; found one real bug. No second real client exists. |

## Payments

| ID | Status | Notes |
| --- | --- | --- |
| PY-1 zap-split tips | tested | 1,000 sats reaches 434 / 266 / 200 / 100. |
| PY-2 unlock goes to the curator's service | tested | Reelstr operators hold nothing in the design; the key server is self-hosted. |
| PY-3 payout rails | tested | Nutzap, Lightning address fallback, dust carry. |
| PY-4 agent payment on acceptance | tested | Paid within a minute; wrong payer, underpay, replay refused. |

## Known gaps and risks

- **Demand is unproven.** Fork rate and unlock conversion are the real tests; the PRD's kill signals stand.
- **Real money paths are untested**: mint behaviour, Lightning fees on small payments, phoenixd backend (`PhoenixdBackend` never ran), LNURL servers other than the mock.
- **Legal is not solved by code.** Custody, money transmission, India VDA tax, and likeness rules need a lawyer before the split service is used with other people's money.
- **The media service uses one shared bearer token** and the browser holds it. Put real auth in front before exposing it.
- **Encrypted episodes are MPEG-TS**, because ffmpeg cannot encrypt fMP4. Keys can be shared by any paying viewer.
- **The Studio Agents page** (commission, review, accept and pay) builds and type-checks but has no browser test; the flow underneath it is tested in `services/agent`.
- **Captions** (NIP-71 `text-track`) are supported in the player but nothing generates them.
- **Not built:** replacing a scene in a live episode is possible (publish a new Cut version) but has no UI; fiat top-up; native apps (out of scope).
- **Docker compose is unverified**; Docker Desktop was not running on the build machine.
- **Open-weight licences**: default adapter is Wan 2.2 (Apache-2.0); MiniMax H3 excludes US/EU/UK/KR and is not offered.
