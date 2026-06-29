import { asc, eq } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import db from "../db/index.js";
import { verifications, wasms } from "../db/schema.js";
import { INVALID_WASM_HASH } from "../lib/responses.js";
import { serializeStatusObject } from "../lib/serialize.js";
import { isValidWasmHash } from "../lib/validate.js";
import { pendingEntry } from "../verify.js";

/**
 * How a freshly-enqueued wasm's verification is kicked off. The default Node
 * server runs it in-process (`startVerification`); the Cloudflare Worker injects
 * a durable queue `send` instead, because a Worker can't keep background work
 * alive past the response.
 */
export type TriggerVerification = (wasmHash: string) => void | Promise<void>;

/**
 * Build the `/wasms/:wasm_hash.json` router, kicking off verification for
 * first-seen wasms via the injected `triggerVerification`.
 */
export function createWasmsRouter(
  triggerVerification: TriggerVerification,
): Router {
  const router = express.Router();

  /**
   * GET /wasms/:wasm_hash.json
   * Returns the verifications this service holds for a single wasm.
   *
   * @openapi
   * /wasms/{wasm_hash}.json:
   *   get:
   *     tags: [wasms]
   *     summary: Look up the verifications a service holds for a wasm
   *     description: >-
   *       Returns the verifications a service holds for a single wasm, keyed on
   *       its content-addressed wasm hash. The path carries a literal `.json`
   *       suffix. A service that has not yet seen the wasm MAY enqueue a
   *       verification and answer `202 Accepted`, with the same body shape, so
   *       the client knows to retry later.
   *     operationId: getWasmVerification
   *     parameters:
   *       - name: wasm_hash
   *         in: path
   *         required: true
   *         description: >-
   *           Lowercase hex SHA-256 of the wasm to look up (64 hex characters).
   *           The path appends a `.json` suffix.
   *         schema:
   *           type: string
   *           pattern: "^[0-9a-f]{64}$"
   *         example: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
   *       - name: network_passphrase
   *         in: query
   *         required: false
   *         description: >-
   *           An optional hint naming the network the client cares about, as its
   *           passphrase. Wasm hashes are network-independent, so this does not
   *           change the result; a service MAY use it for context and MAY ignore
   *           it, but MUST NOT reject a request for omitting it.
   *         schema:
   *           type: string
   *         example: "Public Global Stellar Network ; September 2015"
   *     responses:
   *       "200":
   *         description: >-
   *           The service holds a settled result for this wasm (each verification
   *           is a final `verified`, `mismatched`, or settled `unverified`).
   *         content:
   *           application/json:
   *             schema:
   *               $ref: "#/components/schemas/StatusObject"
   *             examples:
   *               verified:
   *                 summary: A verified wasm with a single verifier
   *                 value:
   *                   schema_version: "1.0"
   *                   wasm_hash: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
   *                   updated_at: "2026-06-04T12:05:00Z"
   *                   source_code_verifications:
   *                     - verifier:
   *                         name: Example Verification Service
   *                         url: https://verify.example.com
   *                         logo_url:
   *                           light: https://verify.example.com/logo.png
   *                           dark: https://verify.example.com/logo-dark.png
   *                       status: verified
   *                       bldimg: docker.io/stellar/stellar-cli@sha256:1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99887766554433221100
   *                       bldopt: ["--manifest-path=contracts/foo/Cargo.toml", "--optimize"]
   *                       source_repo: https://github.com/user/my-contract
   *                       source_rev: abc1234567890abcdef1234567890abcdef12345
   *                       processed_at: "2026-06-04T12:00:00Z"
   *                       results_urls:
   *                         - ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
   *                         - ar://AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789ABC
   *               mismatched:
   *                 summary: Two verifiers that disagree
   *                 value:
   *                   schema_version: "1.0"
   *                   wasm_hash: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
   *                   updated_at: "2026-06-04T13:00:00Z"
   *                   source_code_verifications:
   *                     - verifier:
   *                         name: Verifier A
   *                         url: https://a.example.com
   *                       status: verified
   *                       source_repo: https://github.com/user/my-contract
   *                       source_rev: abc1234567890abcdef1234567890abcdef12345
   *                       processed_at: "2026-06-04T12:00:00Z"
   *                     - verifier:
   *                         name: Verifier B
   *                         url: https://b.example.com
   *                       status: mismatched
   *                       source_repo: https://github.com/user/my-contract
   *                       source_rev: abc1234567890abcdef1234567890abcdef12345
   *                       rebuilt_hash: 999888777666555444333222111000fedcba9876543210fedcba9876543210fe
   *                       processed_at: "2026-06-04T13:00:00Z"
   *               unverified:
   *                 summary: A settled unverified wasm
   *                 value:
   *                   schema_version: "1.0"
   *                   wasm_hash: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
   *                   updated_at: "2026-06-04T12:00:00Z"
   *                   source_code_verifications:
   *                     - verifier:
   *                         name: Example Verification Service
   *                       status: unverified
   *       "202":
   *         description: >-
   *           The service has no completed verification yet but has accepted the
   *           wasm and enqueued one (or one is in progress). The body's
   *           `source_code_verifications` entries are `unverified` and omit
   *           `processed_at`. The client should retry after a sensible interval
   *           (on the order of minutes).
   *         content:
   *           application/json:
   *             schema:
   *               $ref: "#/components/schemas/StatusObject"
   *             example:
   *               schema_version: "1.0"
   *               wasm_hash: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
   *               updated_at: "2026-06-04T12:00:00Z"
   *               source_code_verifications:
   *                 - verifier:
   *                     name: Example Verification Service
   *                   status: unverified
   *       "400":
   *         description: >-
   *           `wasm_hash` is not a valid lowercase hex SHA-256. MAY carry a coded
   *           error body; clients MUST tolerate a `400` without one.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: "#/components/schemas/Error"
   *             example:
   *               schema_version: "1.0"
   *               error: "400_invalid_wasm_hash"
   *               message: wasm_hash is not a valid lowercase hex SHA-256.
   *       "404":
   *         description: >-
   *           The service has no verification for this wasm and will not produce
   *           one (it does not perform on-demand verification, or declines this
   *           wasm). No response body is defined.
   */
  router.get("/wasms/:id", async (req: Request, res: Response) => {
    const raw = req.params.id;
    const id = Array.isArray(raw) ? raw[0] : raw;

    // The path carries a literal `.json` suffix; capture the param and strip it
    // here to avoid express-5 / path-to-regexp dot-matching quirks.
    if (!id.endsWith(".json")) {
      res.status(404).end();
      return;
    }
    const wasmHash = id.slice(0, -".json".length);

    if (!isValidWasmHash(wasmHash)) {
      res.status(400).json(INVALID_WASM_HASH);
      return;
    }

    const [wasm] = await db
      .select()
      .from(wasms)
      .where(eq(wasms.wasmHash, wasmHash))
      .limit(1);

    // Unknown wasm: enqueue a verification and answer 202 Accepted.
    if (!wasm) {
      const { body, isNew } = await enqueue(wasmHash);
      // Kick off the reproducible build only for the request that won the
      // insert, so a flurry of polls doesn't trigger the build more than once.
      // Awaited so a Worker's queue `send` flushes before we respond.
      if (isNew) await triggerVerification(wasmHash);
      res.status(202).json(body);
      return;
    }

    // Service holds the wasm but declines to produce a result.
    if (wasm.state === "declined") {
      res.status(404).end();
      return;
    }

    const rows = await db
      .select()
      .from(verifications)
      .where(eq(verifications.wasmHash, wasmHash))
      .orderBy(asc(verifications.id));

    const body = serializeStatusObject(wasm, rows);
    // pending -> 202 (enqueued/in progress); settled -> 200 OK.
    res.status(wasm.state === "pending" ? 202 : 200).json(body);
  });

  return router;
}

/**
 * Insert a pending record for a first-seen wasm and return its status body
 * along with `isNew`: true only when this call actually created the row (i.e.
 * it should be the one to start verification).
 */
async function enqueue(wasmHash: string) {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(wasms)
      .values({ wasmHash, state: "pending" })
      .onConflictDoNothing()
      .returning();

    // Lost an insert race: fall back to the existing row.
    let wasmRow = inserted;
    if (!wasmRow) {
      [wasmRow] = await tx
        .select()
        .from(wasms)
        .where(eq(wasms.wasmHash, wasmHash))
        .limit(1);
    }

    let rows = await tx
      .select()
      .from(verifications)
      .where(eq(verifications.wasmHash, wasmHash))
      .orderBy(asc(verifications.id));

    if (rows.length === 0) {
      rows = await tx
        .insert(verifications)
        .values(pendingEntry(wasmHash))
        .returning();
    }

    return {
      body: serializeStatusObject(wasmRow, rows),
      isNew: Boolean(inserted),
    };
  });
}
