# Demo

A one-command local Reelstr: relay, crew relay, two Blossom servers, a Cashu mint, media service, indexer, key server, agent, verifier and the web app, seeded with a short story ("The Last Signal"). Everything is local and discarded on exit. The walkthrough is in [`docs/DEMO.md`](../docs/DEMO.md).

```sh
bun run demo          # from the repo root: start the stack and seed the story
bun run demo:empty    # same stack, nothing seeded
```

| Folder | Contents |
| --- | --- |
| `src/` | The demo itself: `index.ts` (entry), `stack.ts` (starts every service), `seed.ts` and `story.ts` (the seeded story), `footage.ts` (generated sample clips) |
| `smoke/` | Browser walkthroughs against a running stack: `viewer.ts` (browse, top up, unlock, Source Verified) and `creator.ts` (fork, commission the agent, replace a scene) |
| `tools/` | `envgen.ts` (write `infra/.env`), `seed-remote.ts` (seed a deployed stack), `rebuild-web.ts`, `screenshots.ts`, `hero-image.ts`, `showcase-doc.ts` |

Each script has its own usage in its header comment, and `package.json` has shortcuts (`bun run --cwd demo smoke:viewer <dir>`).
