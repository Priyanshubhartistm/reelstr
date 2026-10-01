# infra

| Piece | Native (dev) | Container |
| --- | --- | --- |
| Relay (kind allowlist, PoW floor, timestamp window) | `cd services/relay && go build -o bin/relay . && ./bin/relay` | `relay` |
| Blossom | `PORT=3100 infra/blossom/run.sh` (needs `npm install` in `infra/blossom`, then `npm install-scripts approve better-sqlite3` and `npm rebuild better-sqlite3`) | `blossom` |
| Postgres | PGlite (embedded) | `postgres` (the indexer is tested against it: `TEST_DATABASE_URL=postgres://reelstr:reelstr-dev@127.0.0.1:5432/reelstr bun test services/indexer`) |
| Cashu mint | the real Nutshell in `.venv-mint` (see `requirements-mint.txt`) | `mint` profile (dev only: FakeWallet) |

## Containers

The images build and the stack runs with **podman** (rootless) as well as Docker; the compose file uses fully qualified image names for that reason.

```sh
uv tool install podman-compose          # if you use podman
cd infra
BLOSSOM_PUBLIC_URL=http://127.0.0.1:3100 podman-compose -p reelstr up -d relay blossom postgres
# browser tests against these containers (fresh volumes: `down -v` first):
cd .. && E2E_COMPOSE=1 bun test e2e
```

Notes learned the hard way:

- `BLOSSOM_PUBLIC_URL` must be the URL clients actually use. Blob URLs are built from it, and the media service only fetches from the hosts it knows (its SSRF allowlist).
- The relay default is `POW_BITS=16` for scenes. It advertises this in NIP-11, and the client mines it automatically.
- The Blossom image runs on **Node 22**. On Node 24 the container segfaulted intermittently with `better-sqlite3` 11.x.
- Rootless podman accepts TCP connections before the app inside is listening: wait on the app's log line, not just an open port.

## Caption generation
The media service transcribes speech locally for the Desk's "Generate captions (draft)". Install once: `uv venv --python 3.12 .venv-asr && uv pip install --python .venv-asr/bin/python -r requirements-asr.txt` (the `small` model, about 460 MB, downloads on first use). The compose image for the media service does not include it yet; use the native service for captions.

## Real Lightning on regtest
`services/keys/test/lnd.test.ts` and the last test in `services/split/test/split.test.ts` run two real LND nodes on a private Bitcoin regtest chain (podman, no real money). They skip themselves if the images are missing:
`podman pull docker.io/polarlightning/bitcoind:27.0 docker.io/polarlightning/lnd:0.18.3-beta`. The key server reads `LND_URL`, `LND_MACAROON` (hex), `LND_CA`, or `PHOENIXD_URL`, `PHOENIXD_PASSWORD`.
