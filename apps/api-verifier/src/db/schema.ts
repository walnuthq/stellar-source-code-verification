import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * SEP "Contract Verification Registry API" — verification status values.
 * See ecosystem/sep-contract-verification-registry.md §Verification status values.
 */
export const verificationStatus = pgEnum("verification_status", [
  "verified",
  "mismatched",
  "unverified",
]);

/**
 * Server-side lifecycle of a wasm record. Not part of the wire format: it only
 * selects the HTTP status, since a settled `unverified` (200) and an enqueued
 * `unverified` (202) carry identical bodies (SEP §Response).
 *   - settled  -> 200 OK
 *   - pending  -> 202 Accepted (enqueued / in progress)
 *   - declined -> 404 Not Found (service will not produce a result)
 */
export const wasmState = pgEnum("wasm_state", [
  "settled",
  "pending",
  "declined",
]);

/**
 * One row per wasm hash we hold a record for. Keyed on the content-addressed
 * wasm hash (lowercase hex SHA-256), which is network-independent and stable.
 */
export const wasms = pgTable("wasms", {
  wasmHash: text("wasm_hash").primaryKey(),
  state: wasmState("state").notNull().default("pending"),
  // RFC 3339 UTC timestamp of when this record was last updated across all
  // of its verifications. Always present in the response.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per verifier attempt — a single entry of `source_code_verifications`.
 * Optional SEP-58 columns are present only when the verifier knows them; the
 * serializer omits NULL/empty values from the response body.
 */
export const verifications = pgTable("verifications", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  wasmHash: text("wasm_hash")
    .notNull()
    .references(() => wasms.wasmHash, { onDelete: "cascade" }),

  // verifier object
  verifierName: text("verifier_name").notNull(),
  verifierUrl: text("verifier_url"),
  // string | { light?: string; dark?: string }
  verifierLogoUrl: jsonb("verifier_logo_url").$type<
    string | { light?: string; dark?: string }
  >(),

  status: verificationStatus("status").notNull(),
  outOfBand: boolean("out_of_band"),

  // SEP-58 build/source fields
  bldimg: text("bldimg"),
  bldopt: text("bldopt").array(),
  sourceRepo: text("source_repo"),
  sourceRev: text("source_rev"),
  tarballUrl: text("tarball_url"),
  tarballSha256: text("tarball_sha256"),

  // Required for `mismatched`, omitted otherwise.
  rebuiltHash: text("rebuilt_hash"),
  // Required for `verified`/`mismatched`, omitted for `unverified`.
  processedAt: timestamp("processed_at", { withTimezone: true }),

  resultsUrls: text("results_urls").array(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WasmRow = typeof wasms.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type NewVerificationRow = typeof verifications.$inferInsert;
