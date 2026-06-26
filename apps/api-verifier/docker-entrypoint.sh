#!/bin/sh
# Boot the rootless Docker daemon, then serve the Express app.
#
# `stellar contract verify` rebuilds wasm inside Docker, so the daemon must be
# running before we accept a verify request. The upstream dind-rootless entrypoint
# runs dockerd under rootlesskit (slirp4netns); with DOCKER_TLS_CERTDIR empty it
# listens on tcp://0.0.0.0:2375, which DOCKER_HOST points at for both our `docker
# info` check and the `stellar`->`docker` calls.
#
# `--iptables=false --ip6tables=false` are required to run under Cloudflare
# Containers, which don't allow iptables manipulation
# (https://developers.cloudflare.com/sandbox/guides/docker-in-docker/). With
# iptables off the default bridge has no NAT, so the rebuild container runs with
# host networking instead (see stellar-cli's `run_in_container`).
#
# rootless networking REQUIRES slirp4netns (host-net mode lets dockerd start but
# can't create a container network sandbox), and slirp4netns opens /dev/net/tun as
# uid 1000. Cloudflare exposes /dev/net/tun only to root, so we start as root just
# long enough to widen its permissions, then drop to the rootless user (below).
set -eu

# --- Stage 0 (root): make /dev/net/tun usable by the rootless user, then drop. ---
if [ "$(id -u)" = 0 ]; then
  mkdir -p /dev/net
  [ -e /dev/net/tun ] || mknod /dev/net/tun c 10 200 2>/dev/null || true
  chmod 0666 /dev/net/tun 2>/dev/null || true
  export HOME=/home/rootless
  exec su-exec rootless:rootless "$0" "$@"
fi

DOCKER_READY_FILE="${DOCKER_READY_FILE:-/tmp/docker-ready}"
DOCKERD_LOG="${DOCKERD_LOG:-/tmp/dockerd.log}"
rm -f "$DOCKER_READY_FILE"

# Start dockerd in the background via the image's own entrypoint. Capture its
# stdout/stderr so the /debug HTTP route can surface why the daemon failed to come
# up (rootless dind under Cloudflare Containers may hit userns/cgroup/tun limits
# that only show in these logs).
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
