# Reelstr web app

The Reelstr client: React and Vite, one app for watching, forking, curating and paying. It is also the app inside the Android shell ([`apps/mobile`](../mobile)).

```sh
bun run --cwd apps/web dev        # dev server on :5173 against the default local services
bun run --cwd apps/web build      # production build in dist/
bun run --cwd apps/web deploy     # build and deploy to Cloudflare Workers
```

Service addresses are baked in at build time from `VITE_RELAYS`, `VITE_BLOSSOM`, `VITE_MEDIA_URL`, `VITE_INDEXER_URL`, `VITE_KEYS_URL`, `VITE_MINT` and `VITE_VERIFIERS` (see [`infra/README.md`](../../infra/README.md)); `VITE_TESTNET=1` adds the testnet badge, the faucet and the guide.

## Layout

```
src/
  main.tsx  App.tsx  Signed.tsx  Landing.tsx    entry, routing, public landing page
  pages/
    watch/     Home, SeriesPage, Watch, Credits, Feedback
    stories/   StoriesList, StoryPage, Composer
    desk/      Desk                              curator desk
    agents/    Agents        crew/ Crew          earnings/ Earnings
  lib/         moderation, progress, tone        small browser-side helpers
```

Shared UI, the session, wallet and player live in [`packages/ui`](../../packages/ui); protocol logic in `packages/protocol` and `packages/app-core`. Browser tests are in [`e2e/`](../../e2e).
