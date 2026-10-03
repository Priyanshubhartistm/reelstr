# Mutinynet node (real Lightning routing, valueless coins)

A pruned bitcoind (the Mutinynet fork) plus LND, to test Reelstr's Lightning paths over a real public network
without real money. Capped at 1.5 CPU, 1.5 GB and about 2 GB of chain; no public ports.

```sh
cd infra/mutinynet && ./run.sh                    # builds the fork image, starts both containers
# create the wallet once (lncli needs a terminal, so use the REST API; see below)
./fee-test.py status
./fee-test.py open 50000                          # one channel to a well-connected node
./fee-test.py pay 20 21                           # 20 payments of 21 sats, reports the real fee
```

Things that went wrong, so you do not repeat them:
- Neutrino (light client) stalls at block 4001 on Mutinynet. Use bitcoind.
- Stock bitcoind stalls at block 4031: Mutinynet's 30 s blocks need the fork and `-signetblocktime=30`.
- Do not set `bitcoin.signetchallenge` in LND when the backend is bitcoind: LND rejects the chain magic.
- The first sync from genesis (3.5 M blocks) takes a few hours at 1 CPU.
- `secrets/` holds the wallet seed and passwords: valueless, but keep it out of git.
