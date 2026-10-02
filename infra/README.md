# infra

| Piece | Native (dev) | Container |
| --- | --- | --- |
| Relay (kind allowlist, PoW floor, timestamp window) | `cd services/relay && go build -o bin/relay . && ./bin/relay` | `relay` |
| Blossom | `PORT=3100 infra/blossom/run.sh` (needs `npm install` in `infra/blossom`, then `npm install-scripts approve better-sqlite3` and `npm rebuild better-sqlite3`) | `blossom` |
| Postgres | PGlite (embedded) | `postgres` (the indexer is tested against it: `TEST_DATABASE_URL=postgres://reelstr:reelstr-dev@127.0.0.1:5432/reelstr bun test services/indexer`) |
| Cashu mint | the real Nutshell in `.venv-mint` (see `requirements-mint.txt`) | `mint` profile (dev only: FakeWallet) |

## Containers: the whole stack

Everything runs from containers with **podman** (rootless) or Docker; the compose file uses fully qualified image names for that reason. Two Dockerfiles: `services/relay`, `services/crew`, `infra/blossom` (each its own), and the repo-root `Dockerfile` which builds the Bun services (media, indexer, keys, split, agent, verifier) as one image plus the two web apps behind nginx.

```sh
uv tool install podman-compose          # if you use podman
bun demo/src/envgen.ts                  # writes infra/.env with fresh secrets (or: --host <public host or IP>)
cd infra
podman-compose -p reelstr up -d                      # relay, crew, blossom, postgres, media, indexer, keys, web
podman-compose -p reelstr --profile mint --profile agent --profile verifier up -d   # + dev mint (FakeWallet), agent, verifier
cd .. && bun demo/src/remote.ts                      # seed the running stack with the demo story
bun demo/src/smoke.ts shots && bun demo/src/smoke-studio.ts shots   # drive it in a real browser
```

Browsers use `PUBLIC_HOST` (in `infra/.env`) to reach the services; containers use service names. Published events carry the public addresses (blob and mint URLs), so every Bun service maps them back with `URL_REWRITE` (see `.env`/compose); this is what makes `http://localhost:3100/<hash>` fetchable from inside a container.

For a VM: `bun demo/src/envgen.ts --host <the VM's DNS name or IP>`, open ports 3100, 3200, 3300, 3334, 3335, 3338 (dev mint only), 3400, 5173 and 5174, then the same `up` and `remote.ts --host <host>`. There is no TLS in this file: put a reverse proxy in front (and use `https://`/`wss://` hosts in `PUBLIC_HOST`-derived URLs) before exposing it to the internet. Caption generation needs the `services-asr` image: set `MEDIA_TARGET=services-asr`.

Browser tests against only the relay, Blossom and Postgres containers (the rest in-process): `cd infra && podman-compose -p reelstr up -d relay blossom postgres`, then `E2E_COMPOSE=1 bun test e2e` from the root.

Notes learned the hard way:

- `BLOSSOM_PUBLIC_URL` must be the URL clients actually use. Blob URLs are built from it, and the media service only fetches from the hosts it knows (its SSRF allowlist).
- The relay default is `POW_BITS=16` for scenes. It advertises this in NIP-11, and the client mines it automatically.
- The Blossom image runs on **Node 22**. On Node 24 the container segfaulted intermittently with `better-sqlite3` 11.x.
- Rootless podman accepts TCP connections before the app inside is listening: wait on the app's log line, not just an open port.

## Caption generation
The media service transcribes speech locally for the Desk's "Generate captions (draft)". Install once: `uv venv --python 3.12 .venv-asr && uv pip install --python .venv-asr/bin/python -r requirements-asr.txt` (the `small` model, about 460 MB, downloads on first use). In containers use the `services-asr` target (see above).

## Real Lightning on regtest
`services/keys/test/lnd.test.ts` and the last test in `services/split/test/split.test.ts` run two real LND nodes on a private Bitcoin regtest chain (podman, no real money). They skip themselves if the images are missing:
`podman pull docker.io/polarlightning/bitcoind:27.0 docker.io/polarlightning/lnd:0.18.3-beta`. The key server reads `LND_URL`, `LND_MACAROON` (hex), `LND_CA`, or `PHOENIXD_URL`, `PHOENIXD_PASSWORD`.

## WebKit and slow networks
```sh
podman build -t reelstr-webkit infra/webkit && podman run -d --rm --name pw-webkit --network host reelstr-webkit
WEBKIT_WS=ws://127.0.0.1:3999/ node demo/src/smoke.ts shots    # run the viewer path in real WebKit
NETWORK=slow-4g node demo/src/smoke.ts shots                  # Chrome with throttling: 4g | slow-4g | 3g
```
Run these with **Node**, not Bun: Bun's WebSocket client cannot connect to the Playwright server.
