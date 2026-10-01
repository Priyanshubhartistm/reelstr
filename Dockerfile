# Every Bun service (media, indexer, keys, split, agent, verifier) runs from this one image;
# compose picks the entry point. Build context is the repo root.
FROM docker.io/oven/bun:1.3.14-debian AS services
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ENV NODE_ENV=production
# state (key ledger, split ledger) lives here: mount a volume
RUN mkdir /state && chown bun /state
VOLUME /state
USER bun
CMD ["bun", "services/indexer/src/server.ts"]

# Same, plus local speech-to-text for the Desk's "Generate captions". Build with
# `--target services-asr` (compose: MEDIA_TARGET=services-asr). The model downloads on first use
# into HF_HOME, so mount /state to keep it.
FROM services AS services-asr
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/asr \
    && /opt/asr/bin/pip install --no-cache-dir -r /app/requirements-asr.txt
ENV ASR_PYTHON=/opt/asr/bin/python HF_HOME=/state/hf
USER bun

# The two web apps, built with the service addresses a browser should use (build args), then served
# as static files with a single-page-app fallback.
FROM docker.io/oven/bun:1.3.14-debian AS webbuild
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ARG VITE_RELAYS=ws://localhost:3334
ARG VITE_BLOSSOM=http://localhost:3100
ARG VITE_MEDIA_URL=http://localhost:3200
ARG VITE_INDEXER_URL=http://localhost:3300
ARG VITE_KEYS_URL=http://localhost:3400
ARG VITE_MINT=
ARG VITE_VERIFIERS=
ARG VITE_FIAT_DEMO=
ARG VITE_POW_BITS=0
RUN cd apps/studio && bunx vite build && cd ../cinema && bunx vite build

FROM docker.io/library/nginx:1.27-alpine AS web
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=webbuild /app/apps/studio/dist /usr/share/nginx/html/studio
COPY --from=webbuild /app/apps/cinema/dist /usr/share/nginx/html/cinema
EXPOSE 5173 5174
