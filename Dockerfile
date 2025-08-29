# syntax=docker/dockerfile:1.6
FROM node:18.20.5-bullseye-slim AS base

# ---- Tooling & system deps (cached) ----
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends \
  openssh-client \
  python3 \
  g++ \
  build-essential \
  git \
  poppler-utils \
  poppler-data \
  procps \
  locales \
  locales-all \
  libcap-dev \
  && rm -rf /var/lib/apt/lists/*

# Node tooling
RUN yarn config set python /usr/bin/python3 && npm i -g node-gyp
RUN npm i -g npm@9.9.3 pnpm@9.15.0

# Locale & Nx
ENV LANG=en_US.UTF-8 \
  LANGUAGE=en_US:en \
  LC_ALL=en_US.UTF-8 \
  NX_DAEMON=false

# Optional: warm caches to speed builds
RUN cd /usr/src && npm i isolated-vm@5.0.1
RUN pnpm store add @tsconfig/node18@1.0.0 @types/node@18.17.1 typescript@4.9.4

# ------------ BUILD STAGE ------------
FROM base AS build
WORKDIR /usr/src/app

# Install deps
COPY .npmrc package.json package-lock.json ./
# use npm ci; cache npm if you like:
# RUN --mount=type=cache,target=/root/.npm npm ci
RUN npm ci

# Copy source and build
COPY . .
RUN npx nx run-many --target=build --projects=server-api --configuration=production
RUN npx nx run-many --target=build --projects=react-ui

# Install production deps for the built server (once)
WORKDIR /usr/src/app/dist/packages/server/api
RUN npm install --production --force

# ------------ RUNTIME STAGE ------------
FROM base AS run
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Nginx for serving React UI; gettext for envsubst; clean afterward
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update && apt-get install -y --no-install-recommends \
  nginx \
  gettext \
  && rm -rf /var/lib/apt/lists/*

# Copy configs/assets
COPY packages/server/api/src/assets/default.cf /usr/local/etc/isolate
COPY nginx.react.conf /etc/nginx/nginx.conf
COPY --from=build /usr/src/app/LICENSE .

# Create dirs for clarity (optional)
RUN mkdir -p /usr/src/app/dist/packages/{server,engine,shared}

# Copy built artifacts from build stage
COPY --from=build /usr/src/app/dist/packages/engine/  /usr/src/app/dist/packages/engine/
COPY --from=build /usr/src/app/dist/packages/server/  /usr/src/app/dist/packages/server/
COPY --from=build /usr/src/app/dist/packages/shared/  /usr/src/app/dist/packages/shared/

# Copy production node_modules produced in build stage (avoid reinstall)
COPY --from=build /usr/src/app/dist/packages/server/api/node_modules /usr/src/app/dist/packages/server/api/node_modules

# Copy runtime packages (if your server uses code from here at runtime)
COPY --from=build /usr/src/app/packages /usr/src/app/packages

# Copy the built React UI into Nginx document root
COPY --from=build /usr/src/app/dist/packages/react-ui /usr/share/nginx/html/

# Entrypoint & metadata
LABEL service=activepieces
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD curl -fsS http://127.0.0.1/ || exit 1
