import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import db from "../src/db/index.js";
import { wasms } from "../src/db/schema.js";

// In-process registry app. Settling to "verified" requires a running api-verifier
// (the registry fetches API_VERIFIER_URL/verify) plus a reproducible build.
const app = createApp();

// A real, reproducible wasm whose source/build metadata rebuilds to this hash.
const WASM_HASH =
  "fd47cee9dec0bd737d10a967f59d27aa2feb8dc6acc8d09419ca961997b213dd";
const PATH = `/wasms/${WASM_HASH}.json`;

const POLL_INTERVAL_MS = 10_000;
const OVERALL_TIMEOUT_MS = 300_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("real verification flow", () => {
  // Start from a clean slate so the first request enqueues and kicks off the
  // build, rather than reading a row left over from a previous run.
  beforeAll(async () => {
    await db.delete(wasms).where(eq(wasms.wasmHash, WASM_HASH));
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it(
    "enqueues a pending verification, then settles to verified",
    async () => {
      // First sight of the hash: 202 Accepted with a pending (unverified) entry.
      const first = await request(app).get(PATH);
      expect(first.status).toBe(202);
      expect(first.body.wasm_hash).toBe(WASM_HASH);
      expect(first.body.source_code_verifications[0].status).toBe("unverified");

      // Poll until the background build settles the record to verified.
      const deadline = Date.now() + OVERALL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);

        const res = await request(app).get(PATH);
        const entry = res.body.source_code_verifications?.[0];

        if (res.status === 200 && entry?.status === "verified") {
          expect(entry.processed_at).toBeTruthy();
          return; // success
        }

        // Until it settles it must remain a pending (202) unverified record.
        expect(res.status).toBe(202);
        expect(entry?.status).toBe("unverified");
      }

      throw new Error(
        `Verification did not settle to verified within ${OVERALL_TIMEOUT_MS / 1000}s`,
      );
    },
    OVERALL_TIMEOUT_MS + 30_000,
  );
});
