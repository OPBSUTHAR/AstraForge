import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config, corsOptions } from "./config.js";
import { projectsRouter } from "./routes/projects.js";
import { assetsRouter } from "./routes/assets.js";
import { jobsRouter } from "./routes/jobs.js";
import { karmashalaRouter } from "./routes/karmashala.js";

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function createApp(): express.Express {
  const app = express();

  // Security headers
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors(corsOptions()));

  // Rate limit: 100 req / 15min per IP (API only)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/api/health" || req.path.startsWith("/meshes"),
  });
  app.use(limiter);

  app.use(express.json({ limit: "2mb" }));

  // Health with DB + vision + ollama aggregation
  app.get("/api/health", async (_req, res) => {
    const { isMemoryMode } = await import("./db.js");
    let vision: string = "unknown";
    try {
      const r = await fetch(`${config.visionServiceUrl}/health`, { signal: AbortSignal.timeout(1500) });
      vision = r.ok ? "online" : `http_${r.status}`;
    } catch { vision = "offline"; }
    res.json({
      ok: true,
      service: "astraforge-server",
      version: "0.2.0",
      env: config.nodeEnv,
      uptime: process.uptime(),
      storage: isMemoryMode() ? "memory" : "mongodb",
      vision,
      time: new Date().toISOString(),
    });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/jobs", jobsRouter);
  app.use("/api/karmashala", karmashalaRouter);

  // Serve meshes with immutable cache
  app.use(
    "/meshes",
    express.static(config.meshDir, {
      maxAge: "1d",
      fallthrough: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".obj") || filePath.endsWith(".stl")) {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        }
      },
    }),
  );

  // 404
  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}`, code: "NOT_FOUND" });
  });

  // Central error handler (handles multer + validation cleanly)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    // multer / fileFilter string errors
    if (error instanceof Error && error.message.startsWith("Unsupported")) {
      res.status(400).json({ error: error.message, code: "UNSUPPORTED_TYPE" });
      return;
    }
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file too large (max 15MB)", code: "FILE_TOO_LARGE" });
      return;
    }
    if (error && typeof error === "object" && "status" in error) {
      const status = Number((error as unknown as { status: number }).status) || 500;
      res.status(status).json({ error: (error as unknown as Error).message });
      return;
    }
    console.error("[server] unhandled error:", error);
    const msg = config.isProduction ? "Internal server error" : (error as Error).message;
    res.status(500).json({ error: msg, code: "INTERNAL" });
  });

  return app;
}

export { HttpError };
