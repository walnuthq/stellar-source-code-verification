# syntax=docker/dockerfile:1

# Multi-stage image for apps/api-verifier.
#
# The service shells out to `stellar contract verify`, which rebuilds wasm inside
# Docker, so the running container must itself be able to run Docker. We therefore
# base the final stage on `docker:dind-rootless` (Docker-in-Docker, rootless) and
# add a from-source `stellar` CLI plus a Node 24 runtime.
#
# Build from the REPO ROOT (the pnpm lockfile/workspace live there):
#   docker build -f apps/api-verifier/Dockerfile -t api-verifier .

# ---------------------------------------------------------------------------
# Stage 1: build the `stellar` CLI from source (musl, so it runs on Alpine).
# ---------------------------------------------------------------------------
FROM rust:1-alpine AS rust-builder

# Alpine equivalents of: build-essential pkg-config libssl-dev libdbus-1-dev libudev-dev
# plus git/ca-certificates for the `cargo install --git` fetch.
RUN apk add --no-cache \
    build-base \
    pkgconf \
    openssl-dev \
    dbus-dev \
    eudev-dev \
    linux-headers \
    git \
    ca-certificates

# Link dynamically against the shared libs from the *-dev packages above. Rust's
# *-musl target defaults to +crt-static, which would make the linker demand static
# .a archives (libssl.a/libdbus-1.a) that Alpine's -dev packages don't ship; the
# matching .so runtime libs are installed in the final stage instead.
ENV RUSTFLAGS="-C target-feature=-crt-static"

# Pin the stellar-cli revision; override with --build-arg if needed.
ARG STELLAR_CLI_REV=93e1b1671f14830662766c005138b19095fe9307
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install --locked \
      --git https://github.com/stellar/stellar-cli --rev "${STELLAR_CLI_REV}" \
      --root /usr/local \
      stellar-cli
# -> /usr/local/bin/stellar

# ---------------------------------------------------------------------------
# Stage 2: compile the TypeScript app and assemble production dependencies.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS node-builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# Manifests first for a cacheable install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api-verifier/package.json apps/api-verifier/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Source + build.
COPY apps/api-verifier apps/api-verifier
RUN pnpm --filter api-verifier build

# Self-contained production tree (node_modules + package.json) at /opt/prod,
# then drop the compiled output alongside it.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter api-verifier deploy --prod --legacy /opt/prod
RUN cp -r apps/api-verifier/dist /opt/prod/dist

# ---------------------------------------------------------------------------
# Stage 3: final runtime — rootless Docker-in-Docker + stellar + node + app.
# ---------------------------------------------------------------------------
FROM docker:dind-rootless

USER root
# Runtime libs the dynamically-linked `stellar` binary and the node binary need.
RUN apk add --no-cache libstdc++ openssl dbus-libs eudev-libs ca-certificates

# Node 24 runtime (binary only; relies on libstdc++ installed above).
COPY --from=node:24-alpine /usr/local/bin/node /usr/local/bin/node

# stellar CLI built in stage 1.
COPY --from=rust-builder /usr/local/bin/stellar /usr/local/bin/stellar

# Application (owned by the rootless user that dind-rootless runs as).
COPY --from=node-builder --chown=rootless:rootless /opt/prod /home/rootless/app
COPY --chown=rootless:rootless apps/api-verifier/docker-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh

# PORT is read by src/index.ts; DOCKER_HOST/DOCKER_TLS_CERTDIR wire the stellar &
# docker CLIs to the in-container rootless daemon over its forwarded TCP port.
ENV PORT=8080 \
    DOCKER_HOST=tcp://127.0.0.1:2375 \
    DOCKER_TLS_CERTDIR=""

WORKDIR /home/rootless/app
EXPOSE 8080

USER rootless
ENTRYPOINT ["app-entrypoint.sh"]
