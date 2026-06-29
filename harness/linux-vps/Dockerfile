# syntax=docker/dockerfile:1
# E2E harness for the Linux VPS install path. Builds the whole workspace on
# Linux, then runs harness/linux-vps/e2e.sh which proves `localterm install`
# writes the systemd user unit (and degrades gracefully without systemd /
# tailscale / chromium), the daemon serves on loopback, and status/stop work.
FROM node:24-bookworm-slim

# node-pty builds a native addon (python3/make/g++); git for any build-time
# resolution; ca-certificates for TLS; curl for the health probe.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

WORKDIR /repo

# Deps layer: manifests + lockfile + patches + the root postinstall script only,
# so source edits reuse this layer. .dockerignore keeps node_modules out of the
# later COPY so the installed tree isn't clobbered.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/terminal/package.json ./apps/terminal/package.json
COPY apps/website/package.json ./apps/website/package.json
COPY apps/harness/package.json ./apps/harness/package.json
COPY apps/harness/alpha-mask/package.json ./apps/harness/alpha-mask/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY patches ./patches
COPY scripts/fix-node-pty.mjs ./scripts/fix-node-pty.mjs

RUN pnpm install --frozen-lockfile

# Full source + build.
COPY . .
RUN pnpm build

ENV HOME=/root
CMD ["bash", "/repo/harness/linux-vps/e2e.sh"]
