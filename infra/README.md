# Infrastructure

Compose files, container images and deployment notes for running the Reelstr stack.

| Path | Contents |
| --- | --- |
| `docker-compose.yml` | The whole stack: relay, crew relay, Blossom, Postgres, media, indexer, keys, web, plus optional `mint`, `agent`, `verifier` and `payouts` profiles |
| `docker-compose.limits.yml` | Overlay for a shared host: low CPU weight, memory caps, media service capped at one core |
| `.env.example` | Settings template; `bun demo/tools/envgen.ts` writes a real `.env` with fresh secrets |
| `blossom/` | Blossom media server image (Node 22) |
| `android/` | Containerised Android APK build |
| `webkit/` | Playwright WebKit container for browser tests |
| `mutinynet/` | Lightning test node on a public signet ([guide](mutinynet/README.md)) |
| `python/` | Requirements for the local mint and speech-to-text |
| `extensions/` | Fetch script for the nos2x browser extension (signer tests) |
| `web/` | nginx config for the web image |

## Run it locally

Podman (rootless) or Docker both work; the compose file uses fully qualified image names for that reason.

```sh
bun demo/tools/envgen.ts                       # writes infra/.env with fresh secrets
cd infra
podman-compose -p reelstr up -d                # relay, crew, blossom, postgres, media, indexer, keys, web
podman-compose -p reelstr --profile mint --profile agent --profile verifier up -d   # + test mint, agent, verifier
cd .. && bun demo/tools/seed-remote.ts         # seed the running stack with the demo story
bun demo/smoke/viewer.ts shots                 # drive it in a real browser
```

Browsers reach services through `PUBLIC_HOST` in `.env`; containers reach each other by service name. Published events carry public addresses (blob and mint URLs), so every Bun service maps them back with `URL_REWRITE`. The Bun services share one image built from the repo-root `Dockerfile`; caption generation needs the `services-asr` target (`MEDIA_TARGET=services-asr`).

Other pieces run natively for development: the relay (`cd services/relay && go build -o bin/relay . && ./bin/relay`), Blossom (`PORT=3100 infra/blossom/run.sh`), Postgres (PGlite, embedded) and the Cashu mint (Nutshell in `.venv-mint`, see `python/requirements-mint.txt`).

Operating notes:
- `BLOSSOM_PUBLIC_URL` must be the URL clients actually use. Blob URLs are built from it, and the media service fetches only from hosts it knows.
- The relay default is `POW_BITS=16` for scenes. It advertises this in NIP-11, and the client mines it automatically.
- Rootless podman accepts TCP connections before the app is listening: wait on the app's log line, not just an open port.

## Deploy

**Web app (Cloudflare Workers):** the app is static, so it deploys as a Worker with assets.

```sh
cd apps/web && bun run deploy      # vite build && wrangler deploy
```

Service addresses are baked in at build time from `VITE_RELAYS`, `VITE_BLOSSOM`, `VITE_MEDIA_URL`, `VITE_INDEXER_URL`, `VITE_KEYS_URL`, `VITE_MINT` and `VITE_VERIFIERS` (defaults are `127.0.0.1`); users can change them in **Settings** without a rebuild. A public https page cannot call plain `http://` or `ws://` services on other hosts, so backends need TLS (`https://`, `wss://`). Set `VITE_MINT` to give the wallet a default mint.

**Backend on a shared VM behind an existing Caddy:** the services are reached at `https://<host>/reelstr/...` through the host's Caddy, so no new certificate or open port is needed.
1. Build the images locally and ship them, so the VM spends no CPU on builds: `podman-compose -p reelstr build relay crew blossom indexer media`, `podman save -m -o img.tar localhost/reelstr-{relay,crew,blossom,services,media}:latest`, copy, `docker load`.
2. `bun demo/tools/envgen.ts --host <host> --public-base https://<host>/reelstr` writes `infra/.env` and prints the `VITE_*` values for the web build. Copy it with both compose files to the VM.
3. `docker compose -p reelstr -f docker-compose.yml -f docker-compose.limits.yml --profile mint --profile agent --profile verifier up -d --no-build relay crew blossom postgres mint media indexer keys agent verifier`. Everything binds to loopback.
4. Add one `handle_path` per service to the Caddyfile above its catch-all, then `caddy validate` and `systemctl reload caddy`: `/reelstr/relay` to 3334, `/crew` to 3335, `/blossom` to 3100, `/media` to 3200, `/api` to 3300, `/keys` to 3400, `/mint` to 3338. Back the Caddyfile up first.
5. Seed it with `bun demo/tools/seed-remote.ts --public-base https://<host>/reelstr`, then build and deploy the web app with the printed `VITE_*` values.

**Reverse-proxy notes:** NIP-98 signatures name a URL path, so behind a prefix-stripping proxy the services need `PUBLIC_PATH_PREFIX` (`MEDIA_PATH_PREFIX`, `KEYS_PATH_PREFIX`). Blossom builds blob URLs with `new URL(hash, base)`, which drops the last path segment unless the base ends in `/`; the image normalizes this. The mint in this setup is a test mint that issues free test sats.

## Tests against the containers

Browser tests against only the relay, Blossom and Postgres containers (the rest in-process): `cd infra && podman-compose -p reelstr up -d relay blossom postgres`, then `E2E_COMPOSE=1 bun test e2e` from the repo root. `demo/smoke/viewer.ts` also runs in real WebKit and under network throttling:

```sh
podman build -t reelstr-webkit infra/webkit && podman run -d --rm --name pw-webkit --network host reelstr-webkit
WEBKIT_WS=ws://127.0.0.1:3999/ node demo/smoke/viewer.ts shots     # real WebKit (run with Node, not Bun)
NETWORK=slow-4g node demo/smoke/viewer.ts shots                    # Chrome throttled: 4g | slow-4g | 3g
```

## Captions and Lightning

- **Captions:** the media service transcribes speech locally for the Desk's "Generate captions (draft)". Install once: `uv venv --python 3.12 .venv-asr && uv pip install --python .venv-asr/bin/python -r infra/python/requirements-asr.txt` (the `small` model, about 460 MB, downloads on first use).
- **Lightning:** the key server reads `LND_URL`, `LND_MACAROON` (hex) and `LND_CA`, or `PHOENIXD_URL` and `PHOENIXD_PASSWORD`. `services/keys/test/lnd.test.ts` and the last test in `services/split/test/split.test.ts` run two LND nodes on a private regtest chain and skip themselves if the images are missing: `podman pull docker.io/polarlightning/bitcoind:27.0 docker.io/polarlightning/lnd:0.18.3-beta`.
