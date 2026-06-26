import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Router } from "express";
import { DOCKER_READY_FILE, STELLAR_BIN } from "../lib/constants.js";

const router = Router();

/** Lowercase hex SHA-256: exactly 64 hex characters. */
const WASM_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Run `stellar contract verify --wasm-hash <hash> --trust`, which rebuilds the
 * wasm from its recorded SEP-58 build metadata (in Docker) and compares hashes.
 * Resolves with whether the build reproduced (exit 0). Rejects only when the
 * command could not be spawned at all. Can take minutes.
 */
function runVerifyCommand(wasmHash: string): Promise<{ verified: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      STELLAR_BIN,
      ["contract", "verify", "--wasm-hash", wasmHash, "--trust"],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve({ verified: code === 0 }));
  });
}

type VerifyRequestBody = { wasmHash?: string };

/**
 * POST /verify { wasmHash } — run the reproducible build for a single wasm.
 *   - exit 0 (reproduced)        -> 200 { verified: true }
 *   - non-zero exit (mismatch)   -> 200 { verified: false }
 *   - could not spawn the binary -> 500 { error }
 *   - Docker daemon not ready yet -> 503 { error } (retry shortly)
 */
router.post("/verify", async (req, res) => {
  const { wasmHash } = req.body as VerifyRequestBody;

  if (!wasmHash || !WASM_HASH_RE.test(wasmHash)) {
    res.status(400).json({ error: "wasmHash must be a lowercase hex SHA-256" });
    return;
  }

  // The server listens before the in-container Docker daemon finishes booting
  // (see docker-entrypoint.sh); `stellar contract verify` needs Docker, so reject
  // early with a retryable 503 until the entrypoint signals readiness.
  if (!existsSync(DOCKER_READY_FILE)) {
    res
      .status(503)
      .json({ error: "Docker daemon is still starting; retry shortly" });
    return;
  }

  try {
    const { verified } = await runVerifyCommand(wasmHash);
    res.json({ verified });
  } catch (err) {
    console.error(`Could not run verification for ${wasmHash}:`, err);
    const message = err instanceof Error ? err.message : "Verification failed";
    res.status(500).json({ error: message });
  }
});

export default router;
