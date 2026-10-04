# Interoperability

`reader.py` is an independent, standard-library-only Python reader. It parses Reelstr events from raw JSON, verifies signatures and recomputes episode splits, so the protocol is checked by code that shares nothing with the TypeScript implementation. `interop.test.ts` runs it against events produced by `@reelstr/protocol`.

`publish-to-relays.ts` publishes one labelled test scene (with a throwaway key) to the relays you name and reads it back from each:

```sh
bun interop/publish-to-relays.ts wss://relay.damus.io wss://nos.lol
```

The protocol itself is specified in [`docs/nip/reelstr.md`](../docs/nip/reelstr.md).
