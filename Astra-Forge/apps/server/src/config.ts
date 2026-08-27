import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/astraforge"),
  UPLOAD_DIR: z.string().min(1).optional(),
  MESH_DIR: z.string().min(1).optional(),
  VISION_SERVICE_URL: z.string().url().default("http://localhost:5001"),
  GEOMETRY_SERVICE_URL: z.string().url().default("http://localhost:5002"),
  OLLAMA_HOST: z.string().url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("llama3.2"),
  CORS_ORIGIN: z.string().min(1).default("*"),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
});

function parseEnv() {
  const raw = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    MESH_DIR: process.env.MESH_DIR,
    VISION_SERVICE_URL: process.env.VISION_SERVICE_URL,
    GEOMETRY_SERVICE_URL: process.env.GEOMETRY_SERVICE_URL,
    OLLAMA_HOST: process.env.OLLAMA_HOST,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[config] env validation warnings:", parsed.error.flatten().fieldErrors);
    // Fall back to defaults via parse
    return EnvSchema.parse({});
  }
  return parsed.data;
}

const env = parseEnv();

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  mongoUri: env.MONGODB_URI,
  uploadDir: path.resolve(env.UPLOAD_DIR ?? path.join(__dirname, "../storage/uploads")),
  meshDir: path.resolve(env.MESH_DIR ?? path.join(__dirname, "../storage/meshes")),
  visionServiceUrl: env.VISION_SERVICE_URL.replace(/\/$/, ""),
  geometryServiceUrl: env.GEOMETRY_SERVICE_URL.replace(/\/$/, ""),
  ollamaHost: env.OLLAMA_HOST.replace(/\/$/, ""),
  ollamaModel: env.OLLAMA_MODEL,
  corsOrigins: env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
  logLevel: env.LOG_LEVEL,
} as const;

export function ensureStorageDirs(): void {
  for (const dir of [config.uploadDir, config.meshDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (config.logLevel !== "silent") {
    console.log(`[config] uploadDir=${config.uploadDir}`);
    console.log(`[config] meshDir=${config.meshDir}`);
    console.log(`[config] env=${config.nodeEnv} port=${config.port}`);
  }
}

export function corsOptions() {
  if (config.corsOrigins === "*") return { origin: "*" as const };
  return {
    origin: (origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => {
      if (!origin) return cb(null, true); // same-origin / curl
      cb(null, (config.corsOrigins as string[]).includes(origin));
    },
  };
}
