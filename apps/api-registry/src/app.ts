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
