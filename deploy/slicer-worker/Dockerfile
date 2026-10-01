# syntax=docker/dockerfile:1
# Slicer worker image: `npm run estimate:worker` + headless PrusaSlicer CLI.
# Build from the repository root:
#   docker build -f deploy/slicer-worker/Dockerfile -t 3dprint4me-slicer-worker .

# ---- Stage 1: fetch and extract PrusaSlicer (AppImage, no FUSE needed) ----
FROM debian:bookworm-slim AS slicer
ARG PRUSASLICER_VERSION=2.8.1
ARG PRUSASLICER_APPIMAGE_URL="https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.8.1/PrusaSlicer-2.8.1%2Blinux-x64-older-distros-GTK3-202409181354.AppImage"
ARG PRUSASLICER_SHA256=cd5999ee476d8e1a19278af89a25c0b2cd9c66acb10422ae79ca2a181c55cffa
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o prusa.AppImage "$PRUSASLICER_APPIMAGE_URL" \
 && echo "$PRUSASLICER_SHA256  prusa.AppImage" | sha256sum -c - \
 && chmod +x prusa.AppImage \
 && ./prusa.AppImage --appimage-extract >/dev/null \
 && mv squashfs-root /opt/prusaslicer \
 && rm -rf /opt/prusaslicer/usr/share/doc

# ---- Stage 2: node dependencies (production only) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Stage 3: runtime ----
FROM node:22-bookworm-slim
# Runtime libraries the extracted PrusaSlicer links against (GTK3/GL stack; it never opens a display).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgtk-3-0 libglu1-mesa libgl1 libegl1 libdbus-1-3 libexpat1 libglib2.0-0 \
      libx11-6 libxkbcommon0 libcurl4 libwebkit2gtk-4.0-37 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/home/worker \
    TMPDIR=/tmp \
    SLICER_PROVIDER=local-cli \
    SLICER_BIN=/opt/prusaslicer/AppRun \
    SLICER_PROFILE=/app/profiles/default.ini \
    SLICER_ENGINE=prusaslicer-cli
RUN useradd --system --uid 10001 --create-home --home-dir /home/worker --shell /usr/sbin/nologin worker
COPY --from=slicer /opt/prusaslicer /opt/prusaslicer
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
# lib/ imports the shared geometry/quote modules the browser also uses.
COPY public/assets/js ./public/assets/js
COPY scripts/print-estimate-worker.mjs ./scripts/print-estimate-worker.mjs
COPY deploy/slicer-worker/profiles ./profiles
USER worker
# The filesystem can be read-only; the worker only writes to $TMPDIR (a tmpfs) and
# PrusaSlicer's config dir under $HOME, which compose also mounts as tmpfs.
HEALTHCHECK --interval=2m --timeout=20s --start-period=30s --retries=3 \
  CMD node -e "const fs=require('fs');fs.accessSync(process.env.SLICER_BIN,fs.constants.X_OK);fs.accessSync(process.env.SLICER_PROFILE,fs.constants.R_OK)"
CMD ["node", "scripts/print-estimate-worker.mjs"]
