FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm rebuild better-sqlite3 && npm cache clean --force

# runtime image: no compilers, only the built node_modules
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json config.yml ./
ENV PORT=3100 BLOSSOM_DATA=/data BLOSSOM_CONFIG=/app/config.yml BLOSSOM_PUBLIC_URL=http://localhost:3100
VOLUME /data
EXPOSE 3100
# blossom-server-ts builds blob URLs with new URL("<hash>.ext", publicDomain), which drops the last path
# segment unless the base ends in "/": normalize it, so a deployment under a path prefix just works
CMD ["sh", "-c", "export BLOSSOM_PUBLIC_URL=\"${BLOSSOM_PUBLIC_URL%/}/\"; exec node node_modules/blossom-server-ts/build/index.js"]
