import http from "node:http";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { connectDatabase } from "./db.js";
import { ensureStorageDirs, config } from "./config.js";

async function main(): Promise<void> {
  ensureStorageDirs();
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  const { initSocketHttp } = await import("./sockets.js");
  initSocketHttp(server);

  // Graceful error for EADDRINUSE etc.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[astraforge] port ${config.port} already in use — is another instance running?`);
    } else {
      console.error("[astraforge] server error:", err);
    }
    process.exit(1);
  });

  server.listen(config.port, () => {
    console.log(`[astraforge] server listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[astraforge] ${signal} received — shutting down gracefully…`);
    server.close(async () => {
      try {
        await mongoose.disconnect();
        console.log("[astraforge] shutdown complete");
        process.exit(0);
      } catch (e) {
        console.error("[astraforge] shutdown error", e);
        process.exit(1);
      }
    });
    // Force after 8s
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error("[astraforge] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[astraforge] uncaughtException:", err);
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  console.error("[astraforge] failed to start:", error);
  process.exit(1);
});
