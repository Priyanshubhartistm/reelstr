#!/usr/bin/env sh
# Build the real nos2x signer extension (https://github.com/fiatjaf/nos2x) into .cache/nos2x/extension,
# for the NIP-07 browser test. Pins @noble/hashes 1.x (its build breaks on the current release) and nostr-tools 2.12 (it passes hex strings where newer releases require bytes).
set -e
cd "$(dirname "$0")/../.."
dest=.cache/nos2x
[ -f "$dest/extension/background.build.js" ] && { echo "already built: $dest/extension"; exit 0; }
mkdir -p .cache && rm -rf "$dest"
git clone --depth 1 https://github.com/fiatjaf/nos2x.git "$dest"
cd "$dest"
npm install --no-audit --no-fund
npm install --no-audit --no-fund @noble/hashes@1.8.0 nostr-tools@2.12.0
node build.js prod
echo "built: $dest/extension"
