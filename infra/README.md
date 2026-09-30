# infra

| Piece | Native (dev) | Container |
| --- | --- | --- |
| Relay (kind allowlist + PoW floor) | `cd services/relay && bun run start` (Go, khatru, Badger) | `relay` |
| Blossom | `PORT=3100 infra/blossom/run.sh` (needs `npm install` in `infra/blossom`, then `npm install-scripts approve better-sqlite3` and `npm rebuild better-sqlite3`) | `blossom` |
| Postgres | PGlite (embedded, no server) | `postgres` |
| Cashu dev mint | none yet | `mint` profile (FakeWallet) |

`docker compose -f infra/docker-compose.yml up -d relay blossom postgres`. Not exercised on the build machine (Docker Desktop was not running and RAM is tight); the native paths are what the test suite covers.
