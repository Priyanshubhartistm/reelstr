#!/usr/bin/env bash
# Copy the source (read-only mount) to a work dir, build the web app, sync Capacitor, assemble the debug APK.
set -euo pipefail
rsync -a --exclude node_modules --exclude .git --exclude dist --exclude 'apps/mobile/android/build' /src/ /work/
cd /work
bun install --frozen-lockfile
cd apps/mobile
bun run build:web
bunx cap sync android
cd android
export GRADLE_OPTS="-Xmx2g -Dorg.gradle.daemon=false"
./gradlew --no-daemon --max-workers=1 assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk /out/reelstr-debug.apk
ls -l /out/reelstr-debug.apk
