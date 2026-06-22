/**
 * Wire-format types and builders for the Contract Verification Registry API.
 * Field shapes mirror ecosystem/sep-contract-verification-registry.md and the
 * published status-object-1.0.schema.json / error-1.0.schema.json.
 */

/** Response schema version, versioned independently of the SEP. */
export const SCHEMA_VERSION = "1.0";

export type VerificationStatus = "verified" | "mismatched" | "unverified";

export interface Verifier {
  name: string;
  url?: string;
  logo_url?: string | { light?: string; dark?: string };
}

export interface SourceCodeVerification {
  verifier: Verifier;
  status: VerificationStatus;
  out_of_band?: boolean;
  bldimg?: string;
  bldopt?: string[];
  source_repo?: string;
  source_rev?: string;
  tarball_url?: string;
  tarball_sha256?: string;
  rebuilt_hash?: string;
  processed_at?: string;
  results_urls?: string[];
}

export interface StatusObject {
  schema_version: string;
  wasm_hash: string;
  updated_at: string;
  source_code_verifications: SourceCodeVerification[];
}

export type ErrorCode = "400_invalid_wasm_hash" | "400_other";

export interface ErrorBody {
  schema_version: string;
  error: ErrorCode;
  message: string;
}

export function errorBody(error: ErrorCode, message: string): ErrorBody {
  return { schema_version: SCHEMA_VERSION, error, message };
}

export const INVALID_WASM_HASH = errorBody(
  "400_invalid_wasm_hash",
  "wasm_hash is not a valid lowercase hex SHA-256.",
);
