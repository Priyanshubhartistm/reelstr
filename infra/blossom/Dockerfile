FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --no-audit --no-fund && npm rebuild better-sqlite3
COPY config.yml ./
ENV PORT=3100 BLOSSOM_DATA=/data BLOSSOM_CONFIG=/app/config.yml BLOSSOM_PUBLIC_URL=http://localhost:3100
VOLUME /data
EXPOSE 3100
CMD ["node", "node_modules/blossom-server-ts/build/index.js"]
