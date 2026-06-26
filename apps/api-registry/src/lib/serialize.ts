import type { VerificationRow, WasmRow } from "../db/schema.js";
import {
  SCHEMA_VERSION,
  type SourceCodeVerification,
  type StatusObject,
  type Verifier,
} from "./responses.js";

/** RFC 3339 UTC timestamp, e.g. "2026-06-04T12:00:00Z". */
function toRfc3339(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function nonEmpty<T>(arr: T[] | null | undefined): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined;
}

function serializeVerification(row: VerificationRow): SourceCodeVerification {
  const verifier: Verifier = { name: row.verifierName };
  if (row.verifierUrl) verifier.url = row.verifierUrl;
  if (row.verifierLogoUrl) verifier.logo_url = row.verifierLogoUrl;

  const entry: SourceCodeVerification = {
    verifier,
    status: row.status,
  };

  if (row.outOfBand) entry.out_of_band = true;
  if (row.bldimg) entry.bldimg = row.bldimg;
  const bldopt = nonEmpty(row.bldopt);
  if (bldopt) entry.bldopt = bldopt;
  if (row.sourceRepo) entry.source_repo = row.sourceRepo;
  if (row.sourceRev) entry.source_rev = row.sourceRev;
  if (row.tarballUrl) entry.tarball_url = row.tarballUrl;
  if (row.tarballSha256) entry.tarball_sha256 = row.tarballSha256;
  // rebuilt_hash is REQUIRED for `mismatched` and MUST be omitted otherwise.
  if (row.status === "mismatched" && row.rebuiltHash) {
    entry.rebuilt_hash = row.rebuiltHash;
  }
  // processed_at is REQUIRED for verified/mismatched, omitted for unverified.
  if (row.status !== "unverified" && row.processedAt) {
    entry.processed_at = toRfc3339(row.processedAt);
  }
  const resultsUrls = nonEmpty(row.resultsUrls);
  if (resultsUrls) entry.results_urls = resultsUrls;

  return entry;
}

export function serializeStatusObject(
  wasm: WasmRow,
  verifications: VerificationRow[],
): StatusObject {
  return {
    schema_version: SCHEMA_VERSION,
    wasm_hash: wasm.wasmHash,
    updated_at: toRfc3339(wasm.updatedAt),
    source_code_verifications: verifications.map(serializeVerification),
  };
}
