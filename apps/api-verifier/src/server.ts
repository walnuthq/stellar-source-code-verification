import cors from "cors";
import express from "express";
import { ALLOWED_ORIGINS, PORT, STELLAR_BIN } from "./lib/constants.js";
import verifyRouter from "./routes/verify.js";

const app = express();

const allowedOrigins = ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  }),
);

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    timestamp: Date.now(),
    env: { PORT, ALLOWED_ORIGINS, STELLAR_BIN },
  });
});

app.use(verifyRouter);

app.listen(Number(PORT), () => {
  console.log(`api-verifier listening on http://localhost:${PORT}`);
});
