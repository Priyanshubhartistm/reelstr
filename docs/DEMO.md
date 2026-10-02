# Running the demo

```
bun run demo        # about 2 minutes: starts everything, seeds a story, prints URLs and logins
bun run demo:empty  # same stack, nothing seeded
bun demo/src/smoke.ts <dir>         # while it runs: a viewer browses, tops up (invoice and demo card), unlocks, sees Source Verified
bun demo/src/smoke-studio.ts <dir>  # while it runs: Dev forks, commissions the agent and pays it; Ila replaces a scene in episode 1
```

Both smoke scripts pass against the seeded demo in headless Chrome. Logins are stable across runs (keys live in `demo/.demo-keys.json`, git-ignored).

Everything is local: Go relay, NIP-29 crew relay, two Blossom servers, real Nutshell mint (test sats), media service, indexer (PGlite), key server, a mock-model agent, a verifier, and the web app on port 5173. Ctrl+C discards all data. Nothing touches a public relay or real money.

## What is seeded

"The Last Signal": five scenes in a branching tree (Mara roots it, Dev forks two branches, Mara and Ila continue them), a mock-model scene with a full manifest (the verifier labels it Source Verified), Ila following the creators (so her Desk inbox shows their scenes), two episodes curated by Ila (episode 1 free, episode 2 is 21 sats and encrypted), two ratings. Scene footage is generated titled clips (a stand-in for model output).

## Suggested walkthrough (about 6 minutes)

1. **Watch, new key.** Series page: the free episode plays, credits and split show who gets what, the second episode shows the 21-sat paywall.
2. **Pay.** Top up with test sats (invoice settles on the mint), unlock, it plays. Credits show each recipient's share in sats.
3. **Stories tab as Mara** (paste her nsec). Open the story: the tree shows both branches, green nodes are used in an episode. Fork a scene from "Into the Tower" by uploading any clip.
4. **Curator desk as Ila** (curator). Curator desk: open episode 1, replace a scene, publish a new version. Viewers keep their place and rating.
5. **Agents page.** Commission the agent printed at start-up (mock model), review, accept: the agent gets paid by nutzap on acceptance.
6. **Moderation.** Report an episode: it hides for you at once.

## Be upfront about

- The "Pay by card or UPI" box in the wallet is a demo partner: no money moves. Fiat top-up is not a real integration.
- The footage is generated placeholders; no real video model runs unless you add a fal key.
- Sats are test sats on a mint with no value. Real Lightning has not been tested.
