# Contributing

Thanks for helping with Reelstr. This is the short version of how the repo works.

## Setup

You need [bun](https://bun.sh), Go, ffmpeg and Chrome (Python 3 for the optional mint and captions, see [`infra/python`](infra/python)).

```sh
bun install
(cd infra/blossom && npm install && npm rebuild better-sqlite3)
bun run demo          # the full stack with a seeded story
```

## Layout

| Folder | What lives there |
| --- | --- |
| `packages/` | Libraries: protocol, Nostr, Blossom, media, wallet, UI. Each has a README with its main exports |
| `services/` | Deployable services: relay, crew relay, media, indexer, key server, split, agent |
| `apps/` | The web app and the Android shell |
| `demo/`, `e2e/`, `interop/` | The demo stack, browser tests, and the independent Python reader |
| `infra/`, `docs/` | Compose files and deploy notes; documentation |

## Everyday commands

```sh
bun run check         # lint, types and unit tests
bun run lint          # biome only
bun run fix           # biome, applying fixes
bun run test:e2e      # headless-browser tests
```

## Conventions

- **Format and lint:** [Biome](https://biomejs.dev); `bun run fix` before you commit. TypeScript is strict.
- **Names:** files are `kebab-case.ts`, or `PascalCase.tsx` for a React component file; one exported component per page file. Tests sit next to the code they cover in `test/` and end in `.test.ts`.
- **Protocol changes:** update the validators, the fixtures in `packages/protocol/fixtures`, [`docs/nip/reelstr.md`](docs/nip/reelstr.md) and the Python reader together, so all three agree.
- **Commits:** short imperative subject, one logical change each.
- **Docs:** if a command or path in a document changes, update the document in the same commit.

## Pull requests

Describe what changed and why, and say how you tested it. Behaviour changes need a test; the browser tests cover the user-facing flows.
