# End-to-end tests

Headless-browser tests (system Chrome, never a visible window) that drive the built web app against a real relay, Blossom server, media service, indexer and key server. They run from the repo root:

```sh
bun run test:e2e
```

They need Chrome, ffmpeg and Go. Extra tools unlock extra coverage and are skipped when absent: the real Nutshell mint (`infra/python/requirements-mint.txt`), local captions (`infra/python/requirements-asr.txt`), the nos2x extension (`infra/extensions/fetch-nos2x.sh`) and `nak` for the NIP-46 bunker. The browser tests also run against the compose containers with `E2E_COMPOSE=1`; see [`infra/README.md`](../infra/README.md).
