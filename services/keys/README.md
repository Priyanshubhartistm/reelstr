# @reelstr/keys

The key server. Releases an episode's AES-128 key after a valid nutzap (checked against the mint) or a Lightning payment, and keeps a ledger. Lightning runs through LND or phoenixd.

**Main exports:** `createKeyServer`, `openLedger`, `LndBackend`, `PhoenixdBackend`.

**Test:** `bun test services/keys`.
