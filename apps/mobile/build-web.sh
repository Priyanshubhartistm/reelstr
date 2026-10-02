#!/usr/bin/env bash
# Build the web app against the live testnet backend, for the native shell.
# Override B to point at your own stack (bun demo/src/envgen.ts prints the values).
set -euo pipefail
B="${B:-https://4-194-209-138.sslip.io/reelstr}"
cd "$(dirname "$0")/../web"
VITE_TESTNET=1 \
VITE_RELAYS="${B/https/wss}/relay" \
VITE_CREW_RELAY="${B/https/wss}/crew" \
VITE_BLOSSOM="$B/blossom" VITE_MEDIA_URL="$B/media" \
VITE_INDEXER_URL="$B/api" VITE_KEYS_URL="$B/keys" VITE_MINT="$B/mint" \
  bun run build
