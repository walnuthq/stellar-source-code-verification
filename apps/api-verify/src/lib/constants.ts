import "dotenv/config";

/** HTTP port the compute service listens on. */
export const PORT = process.env.PORT ?? "8080";

/** Comma-separated CORS allow-list ("*" allows any origin). */
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "*";

/** Binary used to run the reproducible-build check (override for tests/CI). */
export const STELLAR_BIN = process.env.STELLAR_BIN ?? "stellar";
