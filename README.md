<p align="center">
  <img src="docs/brand/logo.png" alt="Reelstr" width="420">
</p>

<h3 align="center">Open-source Pocket FM on Nostr</h3>

<p align="center">
  Short AI-made scenes anyone can fork, episodes cut by curators, and per-episode payments in sats,<br>
  with the revenue split written into signed events that anyone can verify.
</p>

<p align="center">
  <a href="https://reelstr.ansht.workers.dev"><img alt="Live demo" src="https://img.shields.io/badge/Live_demo-testnet-17432f?style=for-the-badge&logo=cloudflare&logoColor=white"></a>
  <a href="https://github.com/Priyanshubhartistm/reelstr/releases/tag/v0.1.0-testnet"><img alt="Download the Android APK" src="https://img.shields.io/badge/Android-download_APK-3ddc84?style=for-the-badge&logo=android&logoColor=white"></a>
  <a href="docs/ARCHITECTURE.md"><img alt="Architecture" src="https://img.shields.io/badge/Architecture-docs-9b7be0?style=for-the-badge&logo=mermaid&logoColor=white"></a>
  <a href="docs/nip/reelstr.md"><img alt="Protocol" src="https://img.shields.io/badge/Protocol-NIP_draft-8e44ad?style=for-the-badge&logo=nostr&logoColor=white"></a>
  <a href="docs/STATUS.md"><img alt="Verification report" src="https://img.shields.io/badge/Verification-report-2b7a5b?style=for-the-badge&logo=checkmarx&logoColor=white"></a>
</p>

<p align="center">
  <img alt="Nostr" src="https://img.shields.io/badge/Nostr-8e44ad?style=flat-square&logo=nostr&logoColor=white">
  <img alt="Bitcoin Lightning" src="https://img.shields.io/badge/Lightning-f7931a?style=flat-square&logo=lightning&logoColor=white">
  <img alt="Cashu" src="https://img.shields.io/badge/Cashu-ecash-2b7a5b?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-20232a?style=flat-square&logo=react&logoColor=61dafb">
  <img alt="Bun" src="https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white">
  <img alt="Capacitor" src="https://img.shields.io/badge/Android_%2B_iOS-Capacitor-119eff?style=flat-square&logo=capacitor&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square"></a>
</p>

<p align="center">
  <img src="docs/ui/showcase.png" alt="Reelstr on desktop and phone" width="900">
</p>

<p align="center">
  <b><a href="#what-it-is-in-plain-words">What it is</a></b> ·
  <b><a href="#how-it-fits-together">How it works</a></b> ·
  <b><a href="#try-it">Try it</a></b> ·
  <b><a href="#mobile-app">Mobile</a></b> ·
  <b><a href="#status">Status</a></b>
</p>

> **Testnet release.** Every feature is built and running on testnet: free test sats, a faucet, and sample clips you can replace with your own. Going to mainnet is a separate step, listed under [Status](#status).

## What it is, in plain words

Serialized short drama (the Pocket FM and ReelShort model) works, but the platforms own the audience, the catalog and the money. Reelstr asks what happens when no company owns them.

1. **Make a scene.** Upload a 10 to 15 second clip, or commission a bot to make one. Anyone can continue or branch off anyone else's scene, so a story becomes a tree.
2. **Cut an episode.** A curator picks scenes from the tree, orders and trims them into a 60 to 120 second episode, sets a price and publishes it.
3. **Get paid.** Viewers watch the first episodes free, then pay a few sats per episode. Each person's share follows the seconds of their scene in the cut, and the split is public.

Everything is Nostr events plus content-addressed Blossom blobs, so any relay, any media server and any client can take part.

## How it fits together

```mermaid
flowchart LR
  subgraph Clients
    W[Web app<br/>React + Vite]
    M[Mobile app<br/>Capacitor shell]
  end
  subgraph Nostr
    R[Public relay<br/>kind allowlist + PoW]
    C[Crew relay<br/>NIP-29 private rooms]
  end
  subgraph Services
    I[Indexer + Postgres<br/>read model]
    MS[Media service<br/>ffmpeg, HLS, captions]
    K[Key server<br/>releases episode keys]
    S[Split service<br/>optional, custodial]
    A[Generation agent]
    V[Verifier<br/>Source Verified]
  end
  B[(Blossom<br/>content-addressed blobs)]
  MINT[Cashu mint]
  LN[Lightning]

  W & M --> R
  W & M --> C
  W & M --> I
  W & M --> K
  W & M --> B
  I -. subscribes .-> R
  MS --> B
  A --> R
  A --> MS
  V --> R
  K --> MINT
  K --> LN
  S --> MINT
  S --> LN
  S --> R
```

The relay is the source of truth; the indexer is a cache that can be rebuilt from relays alone. More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

## What is in the box

| Piece | What it does |
| --- | --- |
| **Web app** | One app. Watch: player, series pages, paywall, ratings, reports, captions. Create: stories and scene tree, fork and continue, curator desk with timeline editor, crew rooms, agents, earnings. Shared wallet and settings. Public landing page |
| **Mobile app** | The same app in a [Capacitor](apps/mobile) shell for Android and iOS, with a bottom tab bar and safe-area handling |
| **Protocol** | Event kinds, builders, validators and fixtures. Draft spec in [`docs/nip/reelstr.md`](docs/nip/reelstr.md) |
| **Reference relay** | Go (khatru) with a kind allowlist, proof-of-work floor and timestamp window, advertised in NIP-11 |
| **Media service** | Normalizes clips, renders hash-stable HLS ladders with optional AES-128, mirrors blobs, drafts captions locally |
| **Indexer** | Postgres or PGlite read model rebuilt from relays: story trees, credits, earnings, ratings, web-of-trust inbox |
| **Key server and split service** | Releases episode keys for a nutzap or Lightning payment. The split service pays creators out with signed receipts; it is custodial and off unless you acknowledge that |
| **Agent and verifier** | An agent with its own key takes paid scene jobs. A verifier re-renders open-weight scenes from their manifest and publishes a "Source Verified" label |
| **Crew rooms** | Private NIP-29 rooms for drafting before a scene goes public |

Specs touched: NIP-01, 07, 11, 13, 29, 32, 42, 44, 46, 47, 56, 57, 60, 61, 71, 98, Blossom (BUD-01/02/04/11) and Cashu.

## Try it

You need [bun](https://bun.sh), Go, ffmpeg, Python 3 and Chrome. For the real mint and captions see `requirements-mint.txt` and `requirements-asr.txt`.

```sh
bun install
(cd infra/blossom && npm install && npm rebuild better-sqlite3)
bun run demo
```

About two minutes later it prints two URLs and three sign-in keys. Everything is local: a seeded story, "The Last Signal", with a branching scene tree, a free and a paid episode, an AI-made scene with a Source Verified badge, an agent you can commission, and a mint that hands out test sats. Walkthrough: [`docs/DEMO.md`](docs/DEMO.md).

```sh
bun run check       # lint, types, unit tests (215)
bun run test:e2e    # 19 headless-browser tests
```

The deployed demo runs as a **testnet**: a badge, a faucet for 500 free test sats, and a four-step guide. Record your own showcase with [`docs/SHOWCASE.md`](docs/SHOWCASE.md).

## Mobile app

`apps/mobile` wraps the web build in Capacitor, so the phone app and the website are one codebase.

```sh
cd apps/mobile
bun run sync        # builds the web app against the testnet backend, then cap sync
bun run android     # opens Android Studio
bun run apk         # APK: apps/mobile/android/app/build/outputs/apk/debug/
# or download the built one: https://github.com/Priyanshubhartistm/reelstr/releases/latest
```

Point it at your own backend with `B=https://your-host/reelstr bun run sync`. iOS: open `apps/mobile/ios/App` in Xcode on a Mac.

**Build without Android Studio:** `infra/android` builds the APK inside a container, so the host only needs Docker:

```sh
docker build -t reelstr-android infra/android
mkdir -p out && docker run --rm --cpus 1 --memory 5g -v "$PWD:/src:ro" -v "$PWD/out:/out" reelstr-android
```

The APK builds in about 3 minutes on one CPU (5.3 MB) and bundles the current web app pointed at the testnet backend. Sideload it from the [latest release](https://github.com/Priyanshubhartistm/reelstr/releases/latest).

## Deploy

The web app is static and deploys as a Cloudflare Worker with assets. The backend is Docker Compose behind a reverse proxy. Steps and reverse-proxy notes are in [`infra/README.md`](infra/README.md).

## Testnet release

Everything is built and running on testnet: watch, fork, curate, pay, split, agents, crew rooms, wallet, web and Android. What was tested, and how, is in the [verification report](docs/STATUS.md).

**Tested against real systems:** a Cashu mint (Nutshell), Postgres 17, containers, Chrome and WebKit, LND nodes on a private regtest chain, and **Lightning routing on the Mutinynet public signet**: our own channels, 27 routed payments, and the key server's backend paying invoices end to end. Routing costs a flat ~2 sats whatever the amount (9.5% of a 21-sat payment, 1% of 210, 0.2% of 1,000), so unlocks use ecash and Lightning handles top-ups and batched payouts.

**Security model:** episode keys are issued per payment (AES-128 HLS), and a DRM provider can be plugged in at the key server. The split service holds funds between unlock and payout, so it is off by default and needs `acknowledgeCustody`; check local money-transmission rules before enabling it. Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#security-model) and [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md).

## Roadmap

- Connect a live video model (Wan 2.2 via fal, or Gemini Veo; both adapters are included).
- Point the wallet at a mainnet mint and Lightning.
- Publish the Android app to Google Play. iOS runs as the web app.
- Submit the protocol draft as a NIP.

## Repository

```
apps/        web (the app), mobile (Capacitor shell)
packages/    protocol, nostr, blossom, media, wallet, bolt11, app-core, ui, testkit
services/    relay, crew, media, indexer, keys, split, agent (agent + verifier)
demo/        one-command seeded demo, smoke scripts, screenshot tools
e2e/         headless Chrome tests; interop/  an independent Python reader
infra/       compose files, Blossom image, deploy notes
docs/        architecture, verification report, design decisions, protocol draft, design system
```

Design system: [`docs/DESIGN.md`](docs/DESIGN.md). Design decisions: [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md).

## Contributing

Issues and forks welcome. Good places to help: connect a live video model, build another client for the protocol, review the NIP draft, and try it on more devices.

## License

MIT, see [`LICENSE`](LICENSE).
