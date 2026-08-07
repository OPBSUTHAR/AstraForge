import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import { config } from "./config.js";
import { projectsRouter } from "./routes/projects.js";
import { assetsRouter } from "./routes/assets.js";
import { jobsRouter } from "./routes/jobs.js";
import { karmashalaRouter } from "./routes/karmashala.js";

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "astraforge-server", uptime: process.uptime() });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/karmashala", karmashalaRouter);

  // Serve generated meshes to the web client (GLB/OBJ for the 3D viewer).
  app.use("/meshes", express.static(config.meshDir));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server] error:", error);
    res.status(500).json({ error: (error as Error).message });
  });

  return app;
}