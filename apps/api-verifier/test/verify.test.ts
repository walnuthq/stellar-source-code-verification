import request from "supertest";
import { describe, expect, it } from "vitest";

// api-verifier is the compute service: POST /verify runs the reproducible build
// (`stellar contract verify` inside Docker) and answers with whether it
// reproduced. The build needs the service's Docker + stellar toolchain, so the
// test targets a running instance (default the local docker-compose service on
// :8080); override with API_VERIFIER_URL.
const API_VERIFIER_URL =
  process.env.API_VERIFIER_URL ?? "http://localhost:8080";

// A real, reproducible wasm whose recorded SEP-58 metadata rebuilds to this hash.
const WASM_HASH =
  "3d67301ba90bdbdf712a75bcf0061193f481958a5095a29c90465a3529254bcf";

const OVERALL_TIMEOUT_MS = 300_000;

describe("real verification flow", () => {
  it(
    "verifies a reproducible wasm via POST /verify",
    async () => {
      const res = await request(API_VERIFIER_URL)
        .post("/verify")
        .send({ wasmHash: WASM_HASH });

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
    },
    OVERALL_TIMEOUT_MS + 30_000,
  );
});
