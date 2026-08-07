import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/astraforge",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? path.join(__dirname, "../storage/uploads")),
  meshDir: path.resolve(process.env.MESH_DIR ?? path.join(__dirname, "../storage/meshes")),
  visionServiceUrl: process.env.VISION_SERVICE_URL ?? "http://localhost:5001",
  geometryServiceUrl: process.env.GEOMETRY_SERVICE_URL ?? "http://localhost:5002",
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2",
} as const;

/** Ensure the storage directories exist before the server accepts uploads. */
export function ensureStorageDirs(): void {
  for (const dir of [config.uploadDir, config.meshDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}