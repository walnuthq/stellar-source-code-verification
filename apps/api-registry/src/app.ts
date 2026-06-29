/**
 * @openapi
 * components:
 *   schemas:
 *     StatusObject:
 *       type: object
 *       description: >-
 *         The `200`/`202` response body: a single status object keyed on the
 *         wasm hash, carrying one or more verifier-attributed results. A settled
 *         `unverified` (`200`) and an enqueued `unverified` (`202`) share this
 *         exact shape; the distinction is conveyed only by the HTTP status.
 *       required: [schema_version, wasm_hash, updated_at, source_code_verifications]
 *       properties:
 *         schema_version:
 *           type: string
 *           description: >-
 *             The response-schema version this body conforms to, as
 *             `MAJOR.MINOR`, versioned independently of the SEP. Clients SHOULD
 *             branch on `MAJOR` and tolerate a higher `MINOR` (unrecognized
 *             fields and enumeration values).
 *           example: "1.0"
 *         wasm_hash:
 *           type: string
 *           description: The queried wasm hash, echoed back. Lowercase hex SHA-256.
 *           pattern: "^[0-9a-f]{64}$"
 *           example: cb2fc3a1b4d5e6f7081928374655647382910abcdef0123456789abcdef01234
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: >-
 *             RFC 3339 UTC timestamp of when this record was last updated across
 *             all of its verifications. Always present.
 *           example: "2026-06-04T12:05:00Z"
 *         source_code_verifications:
 *           type: array
 *           description: >-
 *             One or more rebuild-from-source verification results, each from one
 *             verifier. MUST contain at least one entry.
 *           minItems: 1
 *           items:
 *             $ref: "#/components/schemas/SourceCodeVerification"
 *     SourceCodeVerification:
 *       type: object
 *       description: >-
 *         One verifier's attempt to rebuild the wasm from source. Fields sourced
 *         from SEP-58 carry the same names and value formats as defined there,
 *         and are present only when the verifier knows them.
 *       required: [verifier, status]
 *       properties:
 *         verifier:
 *           $ref: "#/components/schemas/Verifier"
 *         status:
 *           type: string
 *           description: >-
 *             The verification outcome. Clients MUST tolerate an unrecognized
 *             value and SHOULD treat it as `unverified`.
 *           enum: [verified, mismatched, unverified]
 *         out_of_band:
 *           type: boolean
 *           description: >-
 *             When `true`, this verification was established outside SEP-58's
 *             reproducible-build mechanisms (e.g. a custom or non-allowlisted
 *             build image, or private source). Absent or `false` means a standard
 *             reproducible SEP-58 verification.
 *         bldimg:
 *           type: string
 *           description: SEP-58 `bldimg` — the build image the wasm records.
 *         bldopt:
 *           type: array
 *           description: SEP-58 `bldopt` — the build flags, one entry per flag. Order is not significant.
 *           items:
 *             type: string
 *         source_repo:
 *           type: string
 *           description: SEP-58 `source_repo`.
 *         source_rev:
 *           type: string
 *           description: SEP-58 `source_rev` — full 40-char SHA-1 of the source commit.
 *         tarball_url:
 *           type: string
 *           description: SEP-58 `tarball_url`.
 *         tarball_sha256:
 *           type: string
 *           description: SEP-58 `tarball_sha256` — lowercase hex SHA-256 of the source tarball.
 *         rebuilt_hash:
 *           type: string
 *           description: >-
 *             The conflicting lowercase hex SHA-256 the verifier produced by
 *             rebuilding from source. REQUIRED when `status` is `mismatched` and
 *             MUST be omitted otherwise.
 *           pattern: "^[0-9a-f]{64}$"
 *         processed_at:
 *           type: string
 *           format: date-time
 *           description: >-
 *             RFC 3339 UTC timestamp of when this verification was processed.
 *             REQUIRED for `verified` and `mismatched`; MUST be omitted for
 *             `unverified`.
 *         results_urls:
 *           type: array
 *           description: >-
 *             Zero or more URIs where a fuller, externally-published record of
 *             this verification can be retrieved (build logs, the rebuilt
 *             artifact, or a signed report). Each entry's scheme is open
 *             (`https`, `ipfs`, `ar`, …); entries are opaque, untrusted pointers.
 *           items:
 *             type: string
 *     Verifier:
 *       type: object
 *       description: Identity of the verifier that produced (or is producing) a result.
 *       required: [name]
 *       properties:
 *         name:
 *           type: string
 *           description: A human-readable name for the verifier.
 *         url:
 *           type: string
 *           description: A URL identifying the verifier or describing its methodology.
 *         logo_url:
 *           description: >-
 *             A logo for the verifier. Either a URL string, or an object with
 *             `light` and/or `dark` keys holding URL variants for light and dark
 *             backgrounds.
 *           oneOf:
 *             - type: string
 *             - type: object
 *               properties:
 *                 light:
 *                   type: string
 *                 dark:
 *                   type: string
 *     Error:
 *       type: object
 *       description: >-
 *         The `400 Bad Request` body. No other status defines a JSON body.
 *       required: [schema_version, error, message]
 *       properties:
 *         schema_version:
 *           type: string
 *           description: The response-schema version this body conforms to, as `MAJOR.MINOR`.
 *           example: "1.0"
 *         error:
 *           type: string
 *           description: >-
 *             A stable, machine-readable code. Clients SHOULD branch on this
 *             rather than `message`, and MUST tolerate an unrecognized code.
 *           enum: ["400_invalid_wasm_hash", "400_other"]
 *         message:
 *           type: string
 *           description: >-
 *             A human-readable description of the error. Wording is not stable
 *             and is intended for display and debugging.
 */
import { rpc } from "@stellar/stellar-sdk";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { type Database, dbScope } from "./db/index.js";
import { STELLAR_RPC_URL } from "./lib/constants.js";
import { createWasmsRouter, type TriggerVerification } from "./routes/wasms.js";
import { startVerification } from "./verify.js";

type CreateAppOptions = {
  /**
   * When provided, every request runs inside its own database connection built
   * by this factory and disposed when the response closes. Deployments that
   * cannot share a connection across requests (e.g. Cloudflare Workers over
   * Hyperdrive) supply this; the default Node server omits it and keeps the
   * shared singleton.
   */
  requestDbFactory?: () => Database;

  /**
   * How a first-seen wasm's verification is kicked off. Defaults to the
   * in-process background runner (`startVerification`); the Cloudflare Worker
   * supplies a durable queue `send` instead, since it can't keep background work
   * alive past the response.
   */
  triggerVerification?: TriggerVerification;
};

export const createApp = ({
  requestDbFactory,
  triggerVerification = startVerification,
}: CreateAppOptions = {}): Express => {
  const app = express();

  // Must run before the routers so the request-scoped db is set for the whole
  // handler chain. No-op unless a factory is supplied.
  if (requestDbFactory) {
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const db = requestDbFactory();
      res.once("close", () => {
        void db.$client.end().catch(() => {});
      });
      dbScope.run(db, next);
    });
  }

  // SEP recommends permissive CORS on all responses, including errors.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  // Soroban RPC endpoint (defaults to public mainnet; override with STELLAR_RPC_URL).
  const server = new rpc.Server(STELLAR_RPC_URL);

  app.get("/", async (_req: Request, res: Response) => {
    try {
      const { sequence } = await server.getLatestLedger();
      res.json({
        ledger: sequence,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to fetch latest ledger:", err);
      res.status(502).json({ error: "Failed to fetch latest ledger" });
    }
  });

  // Contract Verification Registry API: GET /wasms/:wasm_hash.json
  app.use(createWasmsRouter(triggerVerification));

  return app;
};
