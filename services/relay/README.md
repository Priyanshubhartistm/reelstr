# Reference relay

A Nostr relay built on [khatru](https://github.com/fiatjaf/khatru). It accepts only the event kinds Reelstr uses, requires a proof-of-work floor on scenes, enforces a `created_at` window, and advertises all three in its NIP-11 document.

```sh
cd services/relay && go build -o bin/relay . && ./bin/relay
```

The container image is built from `Dockerfile` in this folder.
