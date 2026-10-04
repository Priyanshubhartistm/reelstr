# Mutinynet node (Lightning on a public test network)

A pruned Bitcoin Core (the Mutinynet build) plus LND, to exercise Reelstr's Lightning paths over real routing between real nodes, with valueless coins. It runs in capped containers (about 1.75 CPU, 5 GB RAM, 2 GB of chain) with no public ports.

```sh
cd infra/mutinynet && ./run.sh     # builds the Mutinynet bitcoind image, starts bitcoind and two LND nodes
./init-wallet.sh 8081              # create node A's wallet (8082 for node B)
./fee-test.py status               # sync, balance, channels
./fee-test.py open 50000           # one channel to a well-connected node
./fee-test.py pay 20 21            # 20 payments of 21 sats, reports the routing fee
```

Setup notes:
- Run bitcoind with `-signetblocktime=30` (the Mutinynet build) and give it 4 GB of memory. The first sync takes a few hours on one CPU.
- Mutinynet is a custom signet: when LND uses a bitcoind backend, leave `bitcoin.signetchallenge` unset.
- `secrets/` holds wallet seeds and passwords for valueless coins; keep it out of git.
