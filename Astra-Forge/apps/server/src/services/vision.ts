import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../config.js";
import { assets, jobs } from "../data.js";
import { emitAssetUpdate, emitJobUpdate } from "../sockets.js";
import type { PipelineJob } from "@astraforge/shared";

interface VisionServiceResponse {
  meshPath: string;
  meshFormat: string;
  stats: { vertices: number; triangles: number };
  previewDataUrl?: string;
  elapsedMs?: number;
  analysis?: Record<string, unknown>;
}

// Prevent concurrent vision jobs for same asset
const runningJobs = new Set<string>();

export async function runVisionJob(assetId: string): Promise<PipelineJob> {
  const asset = await assets.get(assetId);
  if (!asset) throw new Error(`asset ${assetId} not found`);
  if (runningJobs.has(assetId)) throw new Error(`vision already running for asset ${assetId}`);
  runningJobs.add(assetId);

  const job = await jobs.create({
    type: "vision",
    status: "queued",
    progress: 0,
    input: { assetId, imagePath: asset.sourceImagePath ?? asset.path },
  });

  void (async () => {
    try {
      await update(job.id, { status: "running", progress: 5 });

      const sourceFilename = path.basename(asset.sourceImagePath ?? asset.path);
      const sourceAbsolute = path.join(config.uploadDir, sourceFilename);

      // Security: ensure source is inside uploadDir
      const rel = path.relative(config.uploadDir, sourceAbsolute);
      if (rel.startsWith("..") || path.isAbsolute(rel) && rel.includes("..")) {
        throw new Error("invalid source path");
      }
      try {
        await fs.access(sourceAbsolute);
      } catch {
        throw new Error(`source image not found: ${sourceFilename}`);
      }

      // Early check: vision health for better error
      try {
        const h = await fetch(`${config.visionServiceUrl}/health`, { signal: AbortSignal.timeout(2000) });
        if (!h.ok) throw new Error(`vision health http ${h.status}`);
      } catch {
        throw new Error(`vision service offline at ${config.visionServiceUrl} — run: npm run vision:dev (or npm run dev:all)`);
      }
      const url = `${config.visionServiceUrl}/api/generate`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ srcPath: sourceAbsolute, generator: "procedural", outputFormat: "obj" }),
        signal: AbortSignal.timeout(90_000),
      });

      await update(job.id, { progress: 65 });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`vision service http ${response.status}: ${errText || response.statusText}`);
      }
      const result = (await response.json()) as VisionServiceResponse;
      // 7-star: log analysis for verification
      if (result.analysis) console.log(`[vision] analysis for ${asset.name}:`, JSON.stringify(result.analysis).slice(0, 400));

      const meshAbsolute = path.isAbsolute(result.meshPath) ? result.meshPath : path.join(config.meshDir, path.basename(result.meshPath));

      // Enforce mesh is inside meshDir
      const meshRel = path.relative(config.meshDir, meshAbsolute);
      if (meshRel.startsWith("..")) {
        throw new Error(`vision returned path outside meshDir: ${result.meshPath}`);
      }
      try {
        await fs.access(meshAbsolute);
      } catch {
        throw new Error(`mesh not on disk after vision: ${meshAbsolute}`);
      }
      const meshFilename = path.basename(meshAbsolute);

      // stats guard
      const vertices = Number(result.stats?.vertices) || 0;
      const triangles = Number(result.stats?.triangles) || 0;

      const baseName = path.basename(asset.name, path.extname(asset.name)).slice(0, 60);
      const meshAsset = await assets.create({
        projectId: asset.projectId,
        name: `${baseName}_mesh`,
        source: "vision",
        format: (result.meshFormat as never) || "obj",
        path: meshFilename,
        sourceImagePath: sourceFilename,
        meshUrl: `/meshes/${meshFilename}`,
        previewDataUrl: result.previewDataUrl,
        status: "ready",
        stats: { vertices, triangles },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      });

      await update(job.id, { progress: 95 });
      // Verify mesh is readable and has content before marking done
      const meshStat = await fs.stat(meshAbsolute).catch(() => null);
      if (!meshStat || meshStat.size < 100) throw new Error(`generated mesh empty or unreadable: ${meshFilename}`);
      await update(job.id, {
        status: "done",
        progress: 100,
        output: { assetId: meshAsset.id, meshPath: meshFilename, meshUrl: meshAsset.meshUrl, analysis: result.analysis, previewDataUrl: result.previewDataUrl },
      });
      emitAssetUpdate(meshAsset as unknown as Record<string, unknown>);
      // Also emit log for verification
      console.log(`[vision] verified ${meshFilename} ${meshStat.size} bytes → ${asset.name} analysis ${JSON.stringify(result.analysis)?.slice(0,200)}`);
    } catch (error) {
      const message = (error as Error).message || String(error);
      await update(job.id, { status: "failed", error: message });
    } finally {
      runningJobs.delete(assetId);
    }
  })();

  return job;
}

async function update(id: string, patch: Partial<PipelineJob>): Promise<void> {
  const updated = await jobs.update(id, patch);
  if (updated) emitJobUpdate(id, updated as unknown as Record<string, unknown>);
}
