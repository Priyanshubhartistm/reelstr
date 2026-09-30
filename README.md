# Reelstr

Open-source Pocket FM on Nostr: forkable 10-15 s AI scenes, curator-assembled 60-120 s episodes, per-episode sats with the split declared in signed events.

Start here: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/STATUS.md`](docs/STATUS.md) (what is and is not verified), [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) (where the build differs from the PRD, and why), [`docs/nip/reelstr.md`](docs/nip/reelstr.md) (protocol draft), [`docs/research.md`](docs/research.md) (market and feasibility research).

## Run the tests

Needs bun, Go, ffmpeg, Python 3 and Chrome (for the browser tests).

```sh
bun install
(cd infra/blossom && npm install && npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3)
bun run check       # biome + tsc + unit/integration tests
bun run test:e2e    # headless Chrome against the built apps
```

## Run it locally

```sh
(cd services/relay && go build -o bin/relay . && ./bin/relay)            # public relay :3334
PORT=3100 infra/blossom/run.sh                                            # Blossom :3100
MEDIA_TOKEN=dev bun services/media/src/server.ts                          # media :3200
bun services/indexer/src/server.ts                                        # indexer API :3300
(cd apps/studio && bun run dev)                                           # Studio :5173
(cd apps/cinema && bun run dev)                                           # Cinema :5174
```

Paid episodes also need `services/keys` (`MINTS=<mint url> bun services/keys/src/server.ts`) and a Cashu mint. Crew rooms need `services/crew`. Read `docs/STATUS.md` before pointing any of this at real funds.
