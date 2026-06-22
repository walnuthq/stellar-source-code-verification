import { asc, eq } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import { db } from "../db/client.js";
import { verifications, wasms } from "../db/schema.js";
import { INVALID_WASM_HASH } from "../lib/responses.js";
import { serializeStatusObject } from "../lib/serialize.js";
import { isValidWasmHash } from "../lib/validate.js";
import { pendingEntry, startVerification } from "../verify.js";

export const wasmsRouter: Router = express.Router();

/**
 * GET /wasms/:wasm_hash.json
 * Returns the verifications this service holds for a single wasm.
 */
wasmsRouter.get("/wasms/:id", async (req: Request, res: Response) => {
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
    // Kick off the reproducible build only for the request that won the insert,
    // so a flurry of polls doesn't spawn the worker more than once.
    if (isNew) startVerification(wasmHash);
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

    return { body: serializeStatusObject(wasmRow, rows), isNew: Boolean(inserted) };
  });
}
