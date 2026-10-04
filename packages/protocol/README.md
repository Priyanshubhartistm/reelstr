# @reelstr/protocol

The Reelstr protocol: event kinds, builders, validators and fixtures for stories, scenes, cuts, series, payout receipts and agent jobs, plus the split math that every client recomputes. The spec is in [`docs/nip/reelstr.md`](../../docs/nip/reelstr.md).

**Main exports:** `KIND`, `buildScene`, `buildCut`, `validateCut`, `computeWeights`, `planPayout`.

**Test:** `bun test packages/protocol`.
