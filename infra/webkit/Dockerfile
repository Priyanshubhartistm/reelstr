# Real WebKit (Playwright's build) on Debian 12, served over a Playwright websocket so tests running on
# the host can drive it:  WEBKIT_WS=ws://127.0.0.1:3999/ bun demo/src/smoke.ts
# This is the WebKit ENGINE on Linux. It is not iOS Safari: no ManagedMediaSource on iPhone, different
# autoplay and power rules. It catches engine-level playback and layout breakage, not iOS-specific ones.
FROM docker.io/library/node:22-bookworm-slim
ARG PLAYWRIGHT=1.63.0
WORKDIR /pw
RUN npm init -y >/dev/null && npm i --no-audit --no-fund playwright-core@${PLAYWRIGHT} \
    && npx playwright-core install --with-deps webkit \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 3999
CMD ["npx", "playwright-core", "run-server", "--port", "3999", "--host", "0.0.0.0"]
