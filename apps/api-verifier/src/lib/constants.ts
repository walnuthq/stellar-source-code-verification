import "dotenv/config";

/** HTTP port the compute service listens on. */
export const PORT = process.env.PORT ?? "8080";

/** Comma-separated CORS allow-list ("*" allows any origin). */
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";

/** Binary used to run the reproducible-build check (override for tests/CI). */
export const STELLAR_BIN = process.env.STELLAR_BIN ?? "stellar";

/**
 * Flag file the entrypoint creates once the in-container Docker daemon is ready.
 * `stellar contract verify` needs Docker, so /verify 503s until this file exists
 * (the server starts listening before the daemon finishes booting — see
 * docker-entrypoint.sh).
 */
export const DOCKER_READY_FILE =
  process.env.DOCKER_READY_FILE ?? "/tmp/docker-ready";

/** Log file capturing the in-container dockerd boot output (see /debug route). */
export const DOCKERD_LOG = process.env.DOCKERD_LOG ?? "/tmp/dockerd.log";
