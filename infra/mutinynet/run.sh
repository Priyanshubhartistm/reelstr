#!/usr/bin/env bash
# Mutinynet (a public Lightning signet: valueless coins, real routing between real nodes):
# a pruned bitcoind (the Mutinynet fork, built by bitcoind/Dockerfile) plus LND, capped (1 + 0.75 CPU, about 5 GB, 2 GB of chain), loopback-only. Run from this directory.
set -euo pipefail
D="sudo docker"
mkdir -p secrets
[ -f secrets/pw ] || openssl rand -hex 16 > secrets/pw
[ -f secrets/rpcpass ] || openssl rand -hex 16 > secrets/rpcpass
chmod 600 secrets/*
$D build -q -t reelstr-mutiny-bitcoind bitcoind >/dev/null
$D network create reelstr-ln >/dev/null 2>&1 || true
$D volume create reelstr-btc-data >/dev/null
$D volume create reelstr-lnd-data >/dev/null
$D volume create reelstr-lnd-b-data >/dev/null
$D rm -f reelstr-bitcoind reelstr-lnd reelstr-lnd-b >/dev/null 2>&1 || true
$D run -d --name reelstr-bitcoind --network reelstr-ln --restart unless-stopped --cpus 1 --memory 4g --memory-swap 4g \
  -v reelstr-btc-data:/home/bitcoin/.bitcoin reelstr-mutiny-bitcoind \
  -signet -signetblocktime=30 -signetchallenge=512102f7561d208dd9ae99bf497273e16f389bdbd6c4742ddb8e6b216e64fa2928ad8f51ae \
  -addnode=45.79.52.207:38333 -dnsseed=0 -listen=0 -prune=2000 -dbcache=256 -server=1 \
  -rpcuser=reelstr -rpcpassword="$(cat secrets/rpcpass)" -rpcbind=0.0.0.0 -rpcallowip=172.16.0.0/12 \
  -zmqpubrawblock=tcp://0.0.0.0:28332 -zmqpubrawtx=tcp://0.0.0.0:28333 -fallbackfee=0.0001
$D run -d --name reelstr-lnd --network reelstr-ln --restart unless-stopped --cpus 0.5 --memory 512m \
  -p 127.0.0.1:8081:8080 \
  -v reelstr-lnd-data:/root/.lnd -v "$PWD/lnd.conf:/root/.lnd/lnd.conf:ro" -v "$PWD/secrets:/secrets:ro" \
  docker.io/lightninglabs/lnd:v0.19.3-beta --bitcoind.rpcpass="$(cat secrets/rpcpass)"
# a second node of ours, so a payment can cross a real channel with the first one on both ends
$D run -d --name reelstr-lnd-b --network reelstr-ln --restart unless-stopped --cpus 0.25 --memory 384m \
  -p 127.0.0.1:8082:8080 \
  -v reelstr-lnd-b-data:/root/.lnd -v "$PWD/lnd-b.conf:/root/.lnd/lnd.conf:ro" -v "$PWD/secrets:/secrets:ro" \
  docker.io/lightninglabs/lnd:v0.19.3-beta --bitcoind.rpcpass="$(cat secrets/rpcpass)"
