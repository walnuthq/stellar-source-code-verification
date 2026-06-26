import { httpServerHandler } from "cloudflare:node";
import { createApp } from "api-registry/app";
import { createDb, dbScope } from "api-registry/db";
import { processVerification } from "api-registry/verify";

// Cloudflare Workers entrypoint: run the vendor-neutral Express app from
// `api-registry` on top of the Workers Node-compat HTTP server.
//
// Workers cannot reuse a database connection across requests (a socket is bound
// to the I/O context of the request that opened it), so we open a fresh
// connection per request through Hyperdrive and let the app dispose it when the
// response closes. Hyperdrive keeps the upstream Postgres connections warm at the
// edge, so this stays cheap and avoids exhausting the origin database.
const PORT = Number(process.env.PORT ?? "8081");

// `env` (and therefore the Hyperdrive + queue bindings) is only available per
// request, not at module load. Capture them on first request — stable for the
// lifetime of the isolate.
let connectionString: string | undefined;
let verifyQueue: Queue<{ wasmHash: string }> | undefined;

const app = createApp({
  requestDbFactory: () => {
    if (!connectionString) {
      throw new Error("Hyperdrive connection string not initialized");
    }
    return createDb(connectionString);
  },
  // A Worker can't keep background work alive past the response, so instead of
  // running the build in-process we enqueue it; the `queue` consumer below
  // awaits it durably. Awaited by the route so the send flushes before the 202.
  triggerVerification: async (wasmHash) => {
    if (!verifyQueue) {
      throw new Error("VERIFY_QUEUE binding not initialized");
    }
    await verifyQueue.send({ wasmHash });
  },
});
app.listen(PORT);

const { fetch: fetchHandler } = httpServerHandler({ port: PORT });
if (!fetchHandler) {
  throw new Error("httpServerHandler did not provide a fetch handler");
}

export default {
  fetch(request, env, ctx) {
    connectionString ??= env.HYPERDRIVE.connectionString;
    verifyQueue ??= env.VERIFY_QUEUE;
    return fetchHandler(request, env, ctx);
  },

  // Durable verification worker. Queue consumers have no wall-clock limit, so we
  // can await the (minutes-long) reproducible build and persist the result. Each
  // message gets its own Hyperdrive-backed connection, scoped via `dbScope` so
  // the existing `processVerification` (which reads the ambient `db`) works
  // unchanged. ack on success; retry (up to max_retries, then DLQ) on failure.
  async queue(batch, env) {
    const connStr = env.HYPERDRIVE.connectionString;
    for (const message of batch.messages) {
      const db = createDb(connStr);
      try {
        await dbScope.run(db, () => processVerification(message.body.wasmHash));
        message.ack();
      } catch (err) {
        console.error(`Verification failed for ${message.body.wasmHash}:`, err);
        message.retry();
      } finally {
        await db.$client.end().catch(() => {});
      }
    }
  },
} satisfies ExportedHandler<Env, { wasmHash: string }>;
