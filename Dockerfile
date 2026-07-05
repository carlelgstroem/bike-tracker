# ---- Munin container ----
# Multi-stage: compile TypeScript to dist, install prod deps (with the
# better-sqlite3 native build), then ship a slim runtime.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build toolchain for the better-sqlite3 native addon (falls back from prebuilt).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/munin.db
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
# SQLite history lives here — attach a Railway Volume mounted at /app/data.
# (No Docker VOLUME instruction: Railway's builder rejects it and manages the
# mount itself.)
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
