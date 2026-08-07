import path from "node:path";
import { config } from "../config.js";
import { assets, jobs } from "../data.js";
import { emitJobUpdate } from "../sockets.js";
import type { PipelineJob } from "@astraforge/shared";

/**
 * Run the Phase-2 vision pipeline for an uploaded source image:
 *   image -> (rembg) -> (Trellis / SF3D mesh gen) -> .glb asset
 *
 * The pipeline job is persisted and its progress streamed to subscribed sockets.
 * When the Python vision service (`services/vision`) is not running, this falls
 * back to a "dry-run" completion so the web flow is exercisable end-to-end.
 */
export async function runVisionJob(assetId: string): Promise<PipelineJob> {
  const asset = await assets.get(assetId);
  if (!asset) throw new Error(`asset ${assetId} not found`);

  const job = await jobs.create({
    type: "vision",
    status: "queued",
    progress: 0,
    input: { assetId, imagePath: asset.sourceImagePath ?? asset.path },
  });

  void (async () => {
    try {
      await update(job.id, { status: "running", progress: 5 });
      await update(job.id, { progress: 30 });

      let handled = false;
      try {
        const url = `${config.visionServiceUrl}/generate`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            srcPath: asset.sourceImagePath ?? asset.path,
            generator: "sf3d",
            outputFormat: "glb",
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const result = (await response.json()) as {
            meshPath: string;
            stats: { vertices: number; triangles: number };
          };
          await update(job.id, { progress: 85 });
          const meshAsset = await assets.create({
            projectId: asset.projectId,
            name: `${path.basename(asset.name, path.extname(asset.name))}_mesh`,
            source: "vision",
            format: "glb",
            path: result.meshPath,
            sourceImagePath: asset.sourceImagePath ?? asset.path,
            status: "ready",
            stats: result.stats,
          });
          await update(job.id, {
            status: "done",
            progress: 100,
            output: { assetId: meshAsset.id, meshPath: result.meshPath },
          });
          handled = true;
        }
      } catch {
        // service not running / offline
      }

      if (!handled) {
        await update(job.id, {
          progress: 60,
          status: "done",
          output: {
            dryRun: true,
            note: "vision service not running; pipeline simulated",
          },
        });
      }
    } catch (error) {
      await update(job.id, { status: "failed", error: (error as Error).message });
    }
  })();

  return job;
}

async function update(id: string, patch: Partial<PipelineJob>): Promise<void> {
  const updated = await jobs.update(id, patch);
  if (updated) emitJobUpdate(id, updated as unknown as Record<string, unknown>);
}