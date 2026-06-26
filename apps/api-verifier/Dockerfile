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
# plus git/ca-certificates (Cargo.lock has a git-source dependency fetched at build).
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

# Build the `stellar` CLI from the in-repo git submodule (../../stellar-cli)
# rather than crates.io/git, because we run a local patch on the unreleased
# `contract-verify` branch: the reproducible-build container is launched as a uid
# that can write the bind-mounted source under rootless Docker-in-Docker (see
# stellar-cli/.../build/verifiable.rs `resolve_build_user`). `stellar-cli` is the
# distribution crate (enables `additional-libs`) and depends on the patched
# `soroban-cli`.
WORKDIR /build
COPY stellar-cli ./stellar-cli

# soroban-cli's build script (crate_git_revision) requires GIT_REVISION at
# compile time, normally derived from a `.git` repo or a published crate's
# `.cargo_vcs_info.json`. A raw submodule checkout in the build context has
# neither (the submodule's .git is an out-of-context gitlink), so synthesize the
# vcs-info file with the submodule's pinned revision.
ARG STELLAR_CLI_REV=93e1b1671f14830662766c005138b19095fe9307
RUN printf '{"git":{"sha1":"%s"}}\n' "${STELLAR_CLI_REV}" \
      > stellar-cli/cmd/soroban-cli/.cargo_vcs_info.json

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install --locked \
      --path stellar-cli/cmd/stellar-cli \
      --root /usr/local
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
# Runtime libs the dynamically-linked `stellar` binary and the node binary need,
# plus shadow-uidmap, which provides newuidmap/newgidmap (installed setuid-root)
# that rootless dockerd uses to set up its user namespace.
RUN apk add --no-cache \
    libstdc++ openssl dbus-libs eudev-libs ca-certificates \
    shadow-uidmap

# Node 24 runtime (binary only; relies on libstdc++ installed above).
COPY --from=node:24-alpine /usr/local/bin/node /usr/local/bin/node

# stellar CLI built in stage 1.
COPY --from=rust-builder /usr/local/bin/stellar /usr/local/bin/stellar

# Application (owned by the rootless user that dind-rootless runs as).
COPY --from=node-builder --chown=rootless:rootless /opt/prod /home/rootless/app
COPY --chown=rootless:rootless apps/api-verifier/docker-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh

# `stellar contract verify` writes its source archive under
# $XDG_DATA_HOME/stellar-cli (= /home/rootless/.local/share/stellar-cli). In the
# dind-rootless base, /home/rootless/.local and .local/share are owned by root,
# so the rootless user cannot create that subdir. Pre-create it (and tmp) owned
# by rootless.
RUN mkdir -p /home/rootless/.local/share/stellar-cli/tmp \
    && chown -R rootless:rootless /home/rootless/.local/share/stellar-cli

# Rootless dockerd maps subuids/subgids via newuidmap/newgidmap, which must be
# setuid-root because Cloudflare Containers don't grant CAP_SETUID to the process.
# The dind-rootless base ships them without the bit set, so set it explicitly.
RUN chmod u+s /usr/bin/newuidmap /usr/bin/newgidmap

# Rootless dockerd requires a writable XDG_RUNTIME_DIR (mode 0700). It defaults to
# /run/user/<uid>, but Cloudflare's firecracker rootfs neither provides nor lets
# uid 1000 create /run/user/, so the upstream entrypoint aborts with "need
# writable HOME and XDG_RUNTIME_DIR". Point it at the rootless user's (writable)
# HOME and pre-create it.
RUN mkdir -p /home/rootless/.xdg-runtime \
    && chown rootless:rootless /home/rootless/.xdg-runtime \
    && chmod 700 /home/rootless/.xdg-runtime

# PORT is read by src/server.ts; DOCKER_HOST/DOCKER_TLS_CERTDIR wire the stellar &
# docker CLIs to the in-container rootless daemon over its forwarded TCP port;
# XDG_RUNTIME_DIR relocates rootless dockerd's runtime dir (see above).
ENV PORT=8080 \
    DOCKER_HOST=tcp://127.0.0.1:2375 \
    DOCKER_TLS_CERTDIR="" \
    XDG_RUNTIME_DIR=/home/rootless/.xdg-runtime

WORKDIR /home/rootless/app
EXPOSE 8080

USER rootless
ENTRYPOINT ["app-entrypoint.sh"]
