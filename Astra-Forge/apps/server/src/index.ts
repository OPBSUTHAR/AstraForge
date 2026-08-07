import http from "node:http";
import { createApp } from "./app.js";
import { connectDatabase } from "./db.js";
import { ensureStorageDirs, config } from "./config.js";
import { initSocketHttp } from "./sockets.js";

async function main(): Promise<void> {
  ensureStorageDirs();
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  initSocketHttp(server);

  server.listen(config.port, () => {
    console.log(`[astraforge] server listening on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error("[astraforge] failed to start:", error);
  process.exit(1);
});