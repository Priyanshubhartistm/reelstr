# Crew relay

A NIP-29 relay ([relay29](https://github.com/fiatjaf/relay29)) for crew rooms: private drafts and chat that stay off the public relays until someone releases them.

```sh
cd services/crew && go build -o bin/crew . && ./bin/crew
```

The container image is built from `Dockerfile` in this folder.
