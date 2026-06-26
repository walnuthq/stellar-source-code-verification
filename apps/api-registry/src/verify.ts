import { and, eq } from "drizzle-orm";
import db from "./db/index.js";
import { type NewVerificationRow, verifications, wasms } from "./db/schema.js";
import { API_VERIFY_URL, VERIFIER_NAME, VERIFIER_URL } from "./lib/constants.js";
import type { VerificationStatus } from "./lib/responses.js";

/**
 * Identity this service publishes for the verifications it produces, i.e. the
 * `verifier` object in each `source_code_verifications` entry.
 */
export function ownVerifier(): { name: string; url?: string } {
  return {
    name: VERIFIER_NAME,
    url: VERIFIER_URL ?? undefined,
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

/**
 * Ask the compute service (apps/api-verify) to run the reproducible build for a
 * wasm and report whether it reproduced. Rejects when the service is
 * unreachable or errors; resolves with the `verified` boolean otherwise. Can
 * take minutes (the build runs in Docker on the other side).
 */
async function callVerifyService(wasmHash: string): Promise<boolean> {
  const res = await fetch(`${API_VERIFY_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wasmHash }),
  });
  if (!res.ok) {
    throw new Error(`api-verify responded ${res.status}`);
  }
  const { verified } = (await res.json()) as { verified: boolean };
  return verified;
}

/** Hashes currently being verified in this process, to avoid double-spawning. */
const inFlight = new Set<string>();

/**
 * Fire-and-forget: settle the verification for a freshly enqueued wasm. Calls
 * the compute service, then writes the result back so the next poll returns the
 * settled status (200). Safe to call repeatedly; only one run happens per hash.
 */
export function startVerification(wasmHash: string): void {
  if (inFlight.has(wasmHash)) return;
  inFlight.add(wasmHash);
  processVerification(wasmHash)
    .catch((err) => console.error(`Verification crashed for ${wasmHash}:`, err))
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
    const verified = await callVerifyService(wasmHash);
    status = verified ? "verified" : "unverified";
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
