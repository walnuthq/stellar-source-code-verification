#!/bin/sh
# Boot the rootless Docker daemon, then serve the Express app.
#
# `stellar contract verify` rebuilds wasm inside Docker, so the daemon must be
# running before we start the server. The upstream dind-rootless entrypoint runs
# dockerd under rootlesskit (its unix socket is hidden inside that namespace), but
# because DOCKER_TLS_CERTDIR is empty it also listens on tcp://0.0.0.0:2375 and
# forwards the port to this (parent) namespace — which is what DOCKER_HOST points
# at, for both our `docker info` check and the `stellar`->`docker` calls.
#
# `--iptables=false --ip6tables=false` are required to run under Cloudflare
# Containers, which don't allow iptables manipulation
# (https://developers.cloudflare.com/sandbox/guides/docker-in-docker/). Passing
# the flags as the first args (they start with `-`) keeps the upstream script's
# default setup — the unix + tcp://0.0.0.0:2375 hosts and the 2375 port-forward —
# and just appends them to the dockerd command. With iptables off the default
# bridge has no NAT, so the rebuild container runs with host networking instead
# (see stellar-cli's `run_in_container`).
set -eu

# Start dockerd in the background via the image's own entrypoint.
dockerd-entrypoint.sh --iptables=false --ip6tables=false &

echo "Waiting for Docker daemon..."
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "Docker is up."
    break
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  echo "error: Docker daemon did not become ready in time" >&2
  exit 1
fi

exec node dist/server.js
