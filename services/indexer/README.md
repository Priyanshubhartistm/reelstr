# @reelstr/indexer

The read model. Subscribes to relays, validates events, and derives story trees, credits, earnings, ratings and the web-of-trust inbox in Postgres or PGlite. Everything can be rebuilt from the relay alone.

**Main exports:** `Indexer`, `ingest`, `rebuild`, `storyTree`, `credits`, `earnings`, `createApi`.

**Test:** `bun test services/indexer`.
