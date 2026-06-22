import "dotenv/config";
import { rpc } from "@stellar/stellar-sdk";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { wasmsRouter } from "./routes/wasms.js";

export const app: Express = express();

// SEP recommends permissive CORS on all responses, including errors.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Soroban RPC endpoint (defaults to public mainnet; override with STELLAR_RPC_URL).
const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://mainnet.sorobanrpc.com";
const server = new rpc.Server(rpcUrl);

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
app.use(wasmsRouter);
