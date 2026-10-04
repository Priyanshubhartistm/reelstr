# Architecture

Apps and services meet on Nostr relays (events) and Blossom servers (media). Money is the one exception: the app pays a key server, which releases the episode key.

```mermaid
flowchart LR
  APP["Web and mobile app<br/>(apps/web, apps/mobile)"]
  APP -->|events| RELAY["Public relay<br/>services/relay"]
  APP -->|private drafts| CREW["Crew relay (NIP-29)<br/>services/crew"]
  APP -->|reads| IDX["Indexer + Postgres<br/>services/indexer"]
  APP -->|blobs| BLOS[("Blossom")]
  APP -->|pay, get key| KEYS["Key server<br/>services/keys"]
  KEYS --> MINT["Cashu mint"]
  KEYS --> LN["Lightning"]
  IDX -. subscribes .-> RELAY
  MEDIA["Media service<br/>services/media"] --> BLOS
  AGENT["Generation agent<br/>services/agent"] --> RELAY
  AGENT --> MEDIA
  VER["Verifier"] --> RELAY
  SPLIT["Split service<br/>off by default"] --> RELAY
  SPLIT --> MINT
```

The event kinds and the pay, fork and agent flows are drawn under [Protocol and flows](#protocol-and-flows).


| Piece | Path | Role |
| --- | --- | --- |
| Protocol | `packages/protocol` | Kinds, builders, validators, split math, fixtures. Every other piece imports it. |
| Nostr client | `packages/nostr` | Signers (NIP-07, NIP-46, local), relay pool, PoW. |
| Blossom client | `packages/blossom` | Upload, mirror, hash-verified fetch. |
| Media | `packages/media` | ffmpeg: normalize scenes, render episodes (HLS ladder, AES-128). |
| Wallet | `packages/wallet` | Cashu wallet, NIP-61 nutzaps, NIP-60 storage, NWC, zap splits, unlock and job flows. |
| App core | `packages/app-core` | Publish flows (story, scene, fork, cut, series) and crew rooms, UI-free. |
| Mobile | `apps/mobile` | Capacitor shell around the web build (Android and iOS projects). No separate UI code. |
| UI | `packages/ui` | Login, session, payments provider, HLS player, tree, split table. |
| Relay | `services/relay` | Go/khatru reference relay: kind allowlist + PoW floor. |
| Crew relay | `services/crew` | Go/relay29 NIP-29 rooms for private drafts. |
| Indexer | `services/indexer` | Validated ingest, derived graph, read API. Rebuildable from `events`. |
| Media service | `services/media` | Job API around `packages/media`; publishes content-addressed HLS to Blossom. |
| Key server | `services/keys` | Holds episode keys; releases them for a valid nutzap or Lightning payment. |
| Split service | `services/split` | Custodial payouts with carry and signed receipts. Opt-in. |
| Agent | `services/agent` | Generation agent with adapters, payment on acceptance, Source Verified. |
| Interop | `interop/reader.py` | Independent reader that recomputes splits from raw events, to validate the spec. |

## Protocol and flows

### Event model

```mermaid
flowchart TD
  ST["Story<br/>kind 31810"] --> SC["Scene<br/>kind 34236 (NIP-71)<br/>d = SHA-256 of normalized blob"]
  SC -->|"parent (fork / continue)"| SC
  SC --> CUT["Cut (episode)<br/>kind 31811<br/>scenes + trims + split weights"]
  CUT --> SER["Series<br/>kind 31812"]
  CUT --> PAY["Payout receipt<br/>kind 9810"]
  JR["Job request<br/>kind 9811"] --> JRES["Job result<br/>kind 9812"]
  JRES --> SC
```

### Watch and pay

```mermaid
sequenceDiagram
  actor V as Viewer
  participant App
  participant K as Key server
  participant Mint as Cashu mint
  participant Relay
  V->>App: open a paid episode
  App->>V: paywall (price, public split)
  V->>App: Unlock
  App->>Mint: create nutzap proofs
  App->>K: proofs (NIP-98 signed)
  K->>Mint: check proofs are unspent
  K-->>App: AES-128 episode key
  App->>App: play HLS
  K->>Relay: payout receipts (if split service on)
```

### Create and fork

```mermaid
sequenceDiagram
  actor C as Creator
  participant App
  participant M as Media service
  participant B as Blossom
  participant R as Relay
  participant I as Indexer
  C->>App: pick a clip and a parent scene
  App->>M: normalize (1080x1920, 30 fps, loudness)
  M->>B: upload blob (hash-verified)
  App->>R: publish Scene event (signed)
  R-->>I: event
  I-->>App: story tree and credits update
```

### Commission a bot

```mermaid
sequenceDiagram
  actor U as User
  participant App
  participant A as Agent
  participant R as Relay
  U->>App: prompt and price in sats
  App->>R: job request
  R-->>A: job
  A->>A: generate clip (open-weight model by default)
  A->>R: job result with draft scene
  U->>App: review
  App->>A: pay on accept, publish scene
```

## Security model

- No server holds a user's nsec. Signing happens in the browser (NIP-07 or NIP-46) or in a local key the user backed up.
- Scene blobs are public and content addressed. Paid episodes are encrypted (AES-128 HLS) and the key server issues the episode key to each paying viewer; a DRM provider can be plugged in at the key server for stricter control.
- The indexer is a cache. `events` is the only source of truth, and `rebuild()` regenerates everything else.
- The split service holds funds between an unlock and the payout, so it is off by default and refuses to start without `acknowledgeCustody`. Check local money-transmission rules before enabling it, and run the key server and split service small and self-hosted.

What was tested, and against what, is in the [verification report](VERIFICATION.md).
