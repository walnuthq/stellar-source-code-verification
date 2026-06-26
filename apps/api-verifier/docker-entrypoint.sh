#!/bin/sh
# Boot the rootless Docker daemon, then serve the Express app.
#
# `stellar contract verify` rebuilds wasm inside Docker, so the daemon must be
# running before we accept a verify request. The upstream dind-rootless entrypoint
# runs dockerd under rootlesskit; with DOCKER_TLS_CERTDIR empty it listens on
# tcp://0.0.0.0:2375, which DOCKER_HOST points at for both our `docker info` check
# and the `stellar`->`docker` calls. RootlessKit runs in host-network mode (see
# DOCKERD_ROOTLESS_ROOTLESSKIT_NET in the Dockerfile), so dockerd shares this
# container's network namespace — 2375 is reachable directly, no port-forward.
#
# `--iptables=false --ip6tables=false` are required to run under Cloudflare
# Containers, which don't allow iptables manipulation
# (https://developers.cloudflare.com/sandbox/guides/docker-in-docker/). Passing
# the flags as the first args (they start with `-`) keeps the upstream script's
# default setup and just appends them to the dockerd command. With iptables off
# the default bridge has no NAT, so the rebuild container runs with host
# networking instead (see stellar-cli's `run_in_container`).
#
# IMPORTANT: rootless dockerd takes far longer to boot than the ~20s that
# Cloudflare Containers (@cloudflare/containers) waits for the container to start
# listening on $PORT. So we DON'T block the HTTP server on the daemon: node binds
# $PORT immediately, and the daemon is awaited in the background. Until it's ready,
# /verify returns 503 (it checks $DOCKER_READY_FILE, written below). This keeps the
# container's port health-check fast while Docker finishes booting.
set -eu

DOCKER_READY_FILE="${DOCKER_READY_FILE:-/tmp/docker-ready}"
DOCKERD_LOG="${DOCKERD_LOG:-/tmp/dockerd.log}"
rm -f "$DOCKER_READY_FILE"

# Start dockerd in the background via the image's own entrypoint. Capture its
# stdout/stderr so the /debug HTTP route can surface why the daemon failed to come
# up (rootless dind under Cloudflare Containers may hit userns/cgroup/iptables
# limits that only show in these logs).
dockerd-entrypoint.sh --iptables=false --ip6tables=false >"$DOCKERD_LOG" 2>&1 &

# Await the daemon in the background and mark readiness via $DOCKER_READY_FILE.
# Runs detached so it never delays node's listen() below.
(
  echo "Waiting for Docker daemon..."
  for _ in $(seq 1 180); do
    if docker info >/dev/null 2>&1; then
      echo "Docker is up."
      touch "$DOCKER_READY_FILE"
      exit 0
    fi
    sleep 1
  done
  echo "error: Docker daemon did not become ready in time" >&2
) >>"$DOCKERD_LOG" 2>&1 &

# Start the HTTP server immediately so the container is listening on $PORT well
# inside Cloudflare's port-readiness window, independent of the Docker boot.
exec node dist/server.js
