import "dotenv/config";

/** HTTP server port. */
export const PORT = process.env.PORT ?? "3000";

/** Comma-separated CORS allow-list ("*" allows any origin). */
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";

/**
 * Postgres connection string (direct, or a Hyperdrive connection string).
 * Defaults to the local docker-compose database for development.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://verifier:verifier@localhost:5434/verifier";

/** Compute service that runs `stellar contract verify` (apps/api-verify). */
export const API_VERIFY_URL =
  process.env.API_VERIFY_URL ?? "http://localhost:8080";

/** Soroban RPC endpoint backing the `/` ledger probe. */
export const STELLAR_RPC_URL =
  process.env.STELLAR_RPC_URL ?? "https://mainnet.sorobanrpc.com";

/** Identity this verifier publishes in source_code_verifications[].verifier. */
export const VERIFIER_NAME =
  process.env.VERIFIER_NAME ?? "Example Verification Service";
export const VERIFIER_URL = process.env.VERIFIER_URL;
