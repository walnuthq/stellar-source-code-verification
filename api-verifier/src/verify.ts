import { spawn } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import {
  type NewVerificationRow,
  verifications,
  wasms,
} from "./db/schema.js";
import type { VerificationStatus } from "./lib/responses.js";

/**
 * Identity this service publishes for the verifications it produces, i.e. the
 * `verifier` object in each `source_code_verifications` entry.
 */
export function ownVerifier(): { name: string; url?: string } {
  return {
    name: process.env.VERIFIER_NAME ?? "Example Verification Service",
    url: process.env.VERIFIER_URL ?? undefined,
  };
}

/** The pending (enqueued, not-yet-processed) entry returned on first sight. */
export function pendingEntry(wasmHash: string): NewVerificationRow {
  const verifier = ownVerifier();
  return {
    wasmHash,
    verifierName: verifier.name,
    verifierUrl: verifier.url ?? null,
    status: "unverified",
  };
}

/** Binary used to run the reproducible-build check (override for tests/CI). */
const STELLAR_BIN = process.env.STELLAR_BIN ?? "stellar";

/**
 * Run `stellar contract verify --wasm-hash <hash> --trust`, which rebuilds the
 * wasm from its recorded SEP-58 build metadata (in Docker) and compares hashes.
 * Resolves on exit code 0 (reproduced), rejects otherwise. Can take minutes.
 */
function runVerifyCommand(wasmHash: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      STELLAR_BIN,
      ["contract", "verify", "--wasm-hash", wasmHash, "--trust"],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`stellar contract verify exited with code ${code}`));
    });
  });
}

/** Hashes currently being verified in this process, to avoid double-spawning. */
const inFlight = new Set<string>();

/**
 * Fire-and-forget: settle the verification for a freshly enqueued wasm. Runs the
 * reproducible build, then writes the result back so the next poll returns the
 * settled status (200). Safe to call repeatedly; only one run happens per hash.
 */
export function startVerification(wasmHash: string): void {
  if (inFlight.has(wasmHash)) return;
  inFlight.add(wasmHash);
  processVerification(wasmHash)
    .catch((err) =>
      console.error(`Verification crashed for ${wasmHash}:`, err),
    )
    .finally(() => inFlight.delete(wasmHash));
}

/**
 * Run the build check for an enqueued wasm and persist the outcome: the wasm
 * row moves from `pending` to `settled`, and our verifier entry is updated to
 * `verified` (reproduced) or `unverified` (build failed / could not reproduce).
 */
export async function processVerification(wasmHash: string): Promise<void> {
  let status: VerificationStatus;
  try {
    await runVerifyCommand(wasmHash);
    status = "verified";
  } catch (err) {
    console.error(`Verification failed for ${wasmHash}:`, err);
    status = "unverified";
  }

  const now = new Date();
  const verifier = ownVerifier();
  await db.transaction(async (tx) => {
    await tx
      .update(verifications)
      .set({
        status,
        // processed_at is required for verified, omitted for unverified.
        processedAt: status === "verified" ? now : null,
      })
      .where(
        and(
          eq(verifications.wasmHash, wasmHash),
          eq(verifications.verifierName, verifier.name),
        ),
      );
    await tx
      .update(wasms)
      .set({ state: "settled", updatedAt: now })
      .where(eq(wasms.wasmHash, wasmHash));
  });
}
