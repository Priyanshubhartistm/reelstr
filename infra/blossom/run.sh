#!/usr/bin/env sh
# Usage: PORT=3100 BLOSSOM_DATA=./data ./run.sh
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-3100}"
export BLOSSOM_DATA="${BLOSSOM_DATA:-$PWD/data}"
export BLOSSOM_PUBLIC_URL="${BLOSSOM_PUBLIC_URL:-http://127.0.0.1:$PORT}"
export BLOSSOM_CONFIG="$PWD/config.yml"
mkdir -p "$BLOSSOM_DATA"
exec node node_modules/blossom-server-ts/build/index.js
