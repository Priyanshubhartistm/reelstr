# Reelstr (open-source Pocket FM on Nostr): research handoff

Date: 2026-09-30. Method: 5 wave-1 researchers + 2 wave-2 (gap, expert/demand), 7 findings files in `~/.architect/research/` (raw, not committed). Five claims re-fetched by the orchestrator (marked **[fetched]**). Budget: 7 researchers, one gap round.

## Brief (restated)

Question: is an open-source Nostr-native micro-drama platform (10-15 s AI scenes, forkable, curators cut 60-120 s episodes, per-episode sats, splits declared in signed events) worth building, and which PRD claims are wrong, stale, or risky?
Decision: what Ansh builds first (Bitshala hackathon/fellowship), what to cut, what to verify before code.
Answered = each load-bearing PRD claim tagged with dated sources; prior art and risks mapped.

## Answer first (BLUF)

**Build it, but as a much narrower thing than the PRD.** The plumbing mostly exists; the demand does not yet. Three of the PRD's pillars are weaker than written:

1. **The market case is overstated.** The Pocket FM "$400M micro-drama" story is mostly *audio*, and Pocket FM's video micro-drama app (Pocket TV) was shut down 2026-06-25 **[fetched]**. Deloitte's $7.8B is a Nov 2025 forecast; Sensor Tower's Q1 2026 actual is ~$750M (~$3B annualized, +20% YoY). The 17% creator-payout figure rests on one Substack.
2. **No evidence anyone wants forkable serial video.** Showrunner 2026 usage: NOT FOUND. Collaborative-film precedents (A Swarm of Angels hit 2% of its subscriber target; Wreckamovie and HitRecord wound down) failed. The one Nostr video success, Divine (150K sign-ups), sells *human-made, anti-AI*, which is the opposite of Reelstr's supply side.
3. **Paywall and payout rails are the soft underbelly.** AES-128 HLS keys are shareable by one paying viewer; nutzaps are not proof of spend; a split service that holds sats is on the money-transmission side of FinCEN's line.

What holds up: NIP-71 kinds, Blossom, hls.js + MMS on iPhone, R2/Bunny delivery costs (~$0.01 to ~$2 per 1,000 views), zap-tag splits as a spec, and a PWA route to sats on iOS.

## Findings (claim, confidence, implication, what would change it)

### F1. Market numbers: DISPUTED on magnitude, VERIFIED on existence
- Deloitte: $3.8B (2025) to $7.8B (2026), 60-90 s episodes, published 2025-11-18 [primary, 2025-11]. Forecast only.
- Sensor Tower: Q1 2026 IAP ~$750M, downloads 850M+ (+140%), growth concentrated in low-ARPU regions (SE Asia 32%, LatAm 23%, India 22% of downloads) [primary, 2026]. Deloitte's 2026 number needs ~$1.95B per quarter; the gap is unreconciled (definition difference suspected).
- Pocket FM: ~$400M trailing (Forbes via syndicated copy; Forbes page itself 403) vs "$500M run rate" (TechCrunch 2026-09-10). AI powers 93% of catalog. Creator share "a small percentage"; 17% is a single low-confidence Substack [low, 2026-08].
- Implication: cite Sensor Tower actuals, not Deloitte or Pocket FM, in the pitch. The India angle is soft (Pocket TV exit, low ARPU).
- Would change: a Sensor Tower full-year 2026 number, or a primary creator-payout disclosure.

### F2. Closest prior art is centralized; no Nostr pay-per-episode micro-drama exists (NOT FOUND)
- Fable Showrunner: forkable/remixable AI shows, credits pricing, ~40% creator share (reported, unofficial); latest public data is 2025 [med]. Higgsfield Original Series (2026-03-20) and MicroDrama Studio: centralized, free streaming [med]. IndeeHub: viewers pay by **Stripe card**, filmmakers paid by Lightning/ACH, per-second payouts; no rate, traction, API, or gating method published [primary site, 2026-09].
- Implication: green field on Nostr, but "nobody did it" is also consistent with "nobody wants it". IndeeHub is a weaker partner than the PRD assumes (no spec, fiat-first, per-second not per-episode).
- Would change: Showrunner/IndeeHub usage numbers; an IndeeHub conversation.

### F3. Nostr event design needs three corrections: VERIFIED **[fetched]**
- NIP-71: kind 21/22 regular, 34235/34236 addressable; no parent/fork/remix convention; `text-track` points to a kind 6000 event, not a bare VTT URL; spec internally inconsistent on `duration` placement (imeta vs top-level tag). NIP-71 is `draft`.
- Divine (largest NIP-71 short-video client) publishes **34236**, not 22. Regular kind 22 scenes are immutable and referenceable only by `e` id; addressable 34236 gives stable `a` coordinates (this matters for Cuts and forks).
- No merged NIP for paywalls, forks, Series or Cut. NIP-51 kind 30005 (video sets) is the only collection primitive (`e` refs, no price/split). 34550 collision is moot (NIP-72 is `unrecommended`).
- NIP-90 is `unrecommended` ("got totally out of control") and the DVM repo was archived 2026-09-07 **[fetched]**. There is no text-to-video DVM kind (5202 is image-to-video). The PRD's R3 (NIP-90 generation agents) sits on a dying foundation.
- NIP-57 Appendix G weights confirmed but client-side only (one invoice per recipient, no atomicity); only Amethyst confirmed as an implementer.
- Implication: decide kind 22 vs 34236 now (recommend 34236 + your own immutability via content-hash pins in the Cut, which the PRD already does). Model AI generation as plain API/agent calls, not DVMs.
- Would change: a second client adopting a fork convention; a live video DVM with volume (check DVMDash).

### F4. Streaming: feasible, with hazards: VERIFIED (media researcher) + INFERENCE flagged
- hls.js audio-offset bug at discontinuities (issue #7680, Chrome, closed "works as expected"); independent AAC encodes add 21-44 ms priming gaps. Evidence favors **one continuous render per episode**, which is the PRD's BE-2, not BE-3's client-side stitching. R0's "join gap ≤ 1 frame" via raw scene blobs is the hardest requirement in the doc.
- iPhone Safari exposes ManagedMediaSource only (hls.js uses it since 1.5).
- AES-128 key gating works in hls.js (auth header on key request) but the key is handed to the client; segments are public blobs. Real prevention = DRM ($99-299/mo + ~$0.003-0.005/license). Every Nostr precedent (ZapGate, V4V apps) accepts leakage or does not gate.
- Costs: ~0.12 GB stored per 2-min 3-rung episode; 32-69 GB delivered per 1,000 views. R2 ~$0.01, Bunny $0.16-$2.08 by region/network (primary price pages). Encode time figures are inference; benchmark.
- Blossom retention is per-operator (nostr.build free cap 20 MiB/file; zap.stream cut VOD to 30 days). Paid episodes need a pinned server you control.
- Implication: pick "leakage is acceptable" deliberately and say so (PRD's Spotify analogy is fair), or pay for DRM. Do not call AES-128 a paywall.
- Would change: a measured encode benchmark; a same-machine test of single-playlist vs discontinuity on Android Chrome + iPhone Safari.

### F5. Payments: rails exist, proof and custody are open
- NIP-61 is `draft`; a nutzap is mint-signed and self-proving on *signature* but not on *spend state* (verifier must query the mint; inference). cashu-ts is at 5.0.0-rc.11 (2026-09-22), still an RC. Amethyst 1.12.0 ships NIP-60/61.
- Mint trust: operator controls keys and BTC; no fallback if the operator vanishes [med]. No 2026 rug found (absence of evidence).
- FinCEN (2019 guidance, secondary summaries of PDF): custody is the line; viewer-wallet-direct splits are the unhosted side. No law-firm analysis of zap splits found. **This makes the PRD's BE-7 split service the legally heaviest component.** India: VDA gains taxed 30% + 1% TDS (relevant to Ansh personally receiving sats); FIU-IND registration for VDA service providers.
- Apple 3.1.1 bans crypto unlocks in native apps; web/PWA is the only iOS route (no explicit PWA statement found; inference). US link-out commission unsettled (SCOTUS cert granted 2026-06-30); EU 15% link-out + 5% CTC from 2026-10-01.
- Zap base is small: ~2.7K senders in one Feb-2026 week; all-time 6.44M zaps / 41.76 BTC [low-med aggregator]. Lightning small-payment fee and onboarding failure data: NOT FOUND (twice).
- Implication: for R0-R1 use tips via zap splits (PRD PY-1), which are non-custodial. Defer per-episode unlock and the split service until legal input and a demand signal.
- Would change: a legal opinion on zap-split custody; Lightning fee measurements on 21-1000 sat payments from your own testnet/mainnet runs.

### F6. Open-weight generation is weaker and more encumbered than the PRD implies
- Verified primary: MiniMax H3 (AA's top open model) license excludes **US, EU, UK, South Korea**, needs written authorization above $20M revenue, and requires a "MiniMax H3" UI credit [primary, 2026-08-02]. Wan 3.0 (AA #1) is API-only; newest open Wan is 2.2 (Apache-2.0) [primary org pages + med secondary]. LTX-2.x: free under $10M revenue; ranks ~#22 on AA image-to-video (Elo 1038 vs ~1195 top).
- Cost: fal Wan 2.2 A14B I2V $0.04-0.08 per video-second, so ~$0.40-1.20 per 10-15 s clip; self-hosted is cents to tens of cents (arithmetic). Native audio/lip-sync exists in LTX-2.x and H3.
- Determinism: PyTorch docs disclaim cross-platform reproducibility; no source shows bitwise-reproducible video diffusion across GPUs. **The "Source Verified re-render badge" is unsupported beyond same-arch pinned containers or perceptual match.**
- Copyright: US Copyright Office Part 2 (2025-01-29): prompts alone don't confer authorship; Thaler cert denied 2026-03-02. Creative Commons says CC licenses shouldn't attach to public-domain AI output. **CC-BY-SA meaningfully covers only the human layer** (script, arrangement, edit, LoRA data).
- Implication: for R3, Wan 2.2 (Apache) is the only clean open-weight base for a global platform; the quality gap to closed models is real. Keep R1 "upload from any tool".
- Would change: a real open-weight micro-drama creator workflow case study; a primary source for any Wan 3.x weight release.

### F7. Demand is the unanswered question: DISPUTED/THIN
- Supply boom: AI made >95% of China's new microdramas in Q1 2026 (CNA headline, not opened), 10K+ AI titles/month [low]. Viewer attitude: no representative survey exists (AI Drama Reviews, which has an affiliate COI); "93% prefer human actors" is untraced. Business Insider (Jan 2026 via secondary): ~30% of ReelShort users pay $25-100/month [low-med]. Anecdotal "AI slop" backlash and a DramaBox writer objecting.
- Divine's reception is for the **anti-AI** stance; its ToS is narrower than its marketing (prohibits *deceptive* synthetic media; press says blanket ban). Either way, Reelstr's AI scenes would be rejected or unwelcome there, so Divine's audience is not your audience.
- Zap revenue anecdotes are ~$10 per viral article [low, content-marketing source].
- Implication: demand evidence has to come from you. The PRD's own kill signal ("8 weeks with chaining but no organic forks") is the right test; run it before building payments.

## Expert/opinion map

- Named-expert positions (fiatjaf, hzrd149, Bewick) on pay-per-view video: **NOT FOUND**. What exists: Stacker News 2023 (pre-Blossom): "The issue is paying for bandwidth and storage" vs "users won't pay for decentralized storage instead of YouTube's ad model" [low, dated, no COI]. Calle/Cashu: "enables true micropayments" (promoter COI, low). Zach Mahoney/IndeeHub: pay-per-second as audience "yardstick" (founder COI, promotional). Fable CEO: "Netflix of AI" (seller COI).
- Open disagreement: AI micro-drama viewers care (Reddit, writers) vs don't care (producer Qingge Gao, 2026-08; COI). Unresolved, no survey.
- Expert wave was thin because Nostr's builders publish on Nostr, which is not indexed by the search tool. Reading their notes directly would close this.

## PRD claims: scorecard

| PRD claim | Status |
| --- | --- |
| Deloitte $3.8B to $7.8B | Verified as a forecast; DISPUTED vs Sensor Tower actuals |
| Pocket FM ~$400M, 550K creators, 93% AI | Verified, but mostly audio; TechCrunch says $500M run rate |
| Pocket FM creators ~17% | UNVERIFIED (single Substack) |
| "Pocket FM proved AI + UGC wins in micro-drama" | Wrong as stated; Pocket TV shut 2026-06-25 |
| Kind 22 scenes show in existing clients | Partly; Divine uses 34236 and bans AI |
| NIP-57 App. G split payable by any zap client | Spec yes; only Amethyst confirmed |
| Zap receipts not proof of payment | Verified (spec text) |
| Nutzaps give verifiable payout receipts | Partly (signature yes, spend state needs mint query) |
| NIP-90 agents for generation | Weak: `unrecommended`, repo archived, no text-to-video kind |
| Blossom mirroring (BUD-04) | Exists; servers MAY refuse mirrors |
| AES-128 "paywall" | Enforceable but leakable; not DRM |
| PWA avoids 30% store fee | Plausible; no explicit Apple/Google statement; US/EU rules in flux |
| CC-BY-SA default licensing | Only on human-authored layer |
| "Source Verified" re-render badge | Unsupported beyond same-arch/perceptual |
| Wan/LTX/HunyuanVideo as open models | Wan 3.0 closed; H3 excludes US/EU; Hunyuan restricted; Wan 2.2 and LTX-2 (capped) remain |

## Open questions (next round's input)

1. Does anyone fork? Specific experiment: ship Studio + a tree view with 10 seed creators for 8 weeks; measure fork rate (PRD's kill signal).
2. Zap-split custody law: ask a lawyer or FinCEN-literate source whether viewer-direct zap splits from a Cut are unhosted. Also India VDA/TDS treatment for a creator receiving sats.
3. Gapless joins: same-device test of a single concatenated HLS playlist vs discontinuity playlist on Android Chrome + iPhone Safari; encode benchmark for 12 s clips and 2-min ladders.
4. Lightning fees and onboarding on 21-1000 sat payments: run 50 real payments through NWC + Cashu wallets and record fees and failure.
5. Nutzap spend verification: prototype mint spent-check (NUT-07) for key release; confirm proof-of-payment semantics.
6. Wan 3.x weights and MiniMax H3's exact scope ("use" vs "local deployment"): read raw LICENSE text and any Alibaba release post.
7. Showrunner and IndeeHub 2026 traction; contact IndeeHub directly for payout rates and a spec.
8. Nostr-native voices (fiatjaf, hzrd149, Divine team): query relays or their notes, which the search tool cannot reach.
9. Reelstr name/trademark (PRD open question; not researched).

## Sources (fetched this session unless noted)

Orchestrator-fetched: https://github.com/nostr-protocol/data-vending-machines (archived 2026-09-07); https://bestmediainfo.com/mediainfo/mediainfo-marketing/pocket-fm-exits-microdrama-space-with-pocket-tv-shutdown-amid-rising-competition-12104199 (2026-06-25); https://raw.githubusercontent.com/nostr-protocol/nips/master/71.md.
Researcher-fetched (see raw files for full lists, ≥150 URLs): NIPs repo (HEAD 0046368a, 2026-09-27); Deloitte TMT 2026 (primary, 2025-11); Sensor Tower 2025/2026 reports (primary); huggingface.co/MiniMaxAI/MiniMax-H3 LICENSE (primary, 2026-08-02); huggingface.co/Wan-AI; artificialanalysis.ai video leaderboards; github.com/hzrd149/blossom (+BUD-04/07); divinevideo/divine-web and divine.video/terms; indeehub.studio; cloudflare/backblaze/bunny pricing pages; PyTorch randomness docs; copyright.gov AI Part 2 report; FinCEN FIN-2019-G001; Apple guidelines 3.1.1; TechCrunch 2026-09-10 (Pocket FM).
Low-tier (pointers only): aggregator blogs on Wan 3.0, HunyuanVideo VRAM, Lightning network stats, Substack on Pocket FM payouts.
