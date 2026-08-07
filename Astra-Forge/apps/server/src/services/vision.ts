import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";
import { assets, jobs } from "../data.js";
import { emitAssetUpdate, emitJobUpdate } from "../sockets.js";
import type { ModelAsset, PipelineJob } from "@astraforge/shared";

interface VisionServiceResponse {
  meshPath: string;
  meshFormat: string;
  stats: { vertices: number; triangles: number };
  previewDataUrl?: string;
}

/**
 * Run the vision pipeline for an uploaded source image:
 *   image -> (Python vision service) -> .obj/.glb mesh on disk
 *
 * The Node backend writes the upload dir + mesh dir to .env so the Python
 * service can find the source and write the output to the same location the
 * browser fetches from via /meshes/<file>.
 *
 * Progress is streamed over Socket.IO (`job:update`) and the resulting asset
 * is broadcast on `asset:update` so the holographic stage can pick it up
 * immediately without polling.
 */
export async function runVisionJob(assetId: string): Promise<PipelineJob> {
  const asset = await assets.get(assetId);
  if (!asset) throw new Error(`asset ${assetId} not found`);

  const job = await jobs.create({
    type: "vision",
    status: "queued",
    progress: 0,
    input: {
      assetId,
      imagePath: asset.sourceImagePath ?? asset.path,
    },
  });

  // run async — caller already has the job id, results stream over socket
  void (async () => {
    try {
      await update(job.id, { status: "running", progress: 5 });

      // Resolve the source image absolute path for the python service.
      const sourceFilename = asset.sourceImagePath ?? asset.path;
      const sourceAbsolute = path.join(config.uploadDir, sourceFilename);

      const url = `${config.visionServiceUrl}/api/generate`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          srcPath: sourceAbsolute,
          generator: "procedural",
          outputFormat: "obj",
        }),
        // the python service can take a few seconds for big images; 60s is safe
        signal: AbortSignal.timeout(60_000),
      });

      await update(job.id, { progress: 65 });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`vision service http ${response.status}: ${errText || response.statusText}`);
      }
      const result = (await response.json()) as VisionServiceResponse;

      // Confirm the mesh file actually exists on disk before we declare
      // success — the python service may write outside MESH_DIR.
      const meshAbsolute = path.isAbsolute(result.meshPath)
        ? result.meshPath
        : path.join(config.meshDir, result.meshPath);
      if (!fs.existsSync(meshAbsolute)) {
        throw new Error(`mesh not on disk after vision: ${meshAbsolute}`);
      }
      const meshFilename = path.basename(meshAbsolute);

      const baseName = path.basename(asset.name, path.extname(asset.name));
      const meshAsset = await assets.create({
        projectId: asset.projectId,
        name: `${baseName}_mesh`,
        source: "vision",
        format: "obj",
        path: meshFilename,
        sourceImagePath: sourceFilename,
        meshUrl: `/meshes/${meshFilename}`,
        previewDataUrl: result.previewDataUrl,
        status: "ready",
        stats: result.stats,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      });

      await update(job.id, { progress: 95 });
      await update(job.id, {
        status: "done",
        progress: 100,
        output: { assetId: meshAsset.id, meshPath: meshFilename, meshUrl: meshAsset.meshUrl },
      });

      emitAssetUpdate(meshAsset);
    } catch (error) {
      const message = (error as Error).message || String(error);
      await update(job.id, { status: "failed", error: message });
    }
  })();

  return job;
}

async function update(id: string, patch: Partial<PipelineJob>): Promise<void> {
  const updated = await jobs.update(id, patch);
  if (updated) emitJobUpdate(id, updated as unknown as Record<string, unknown>);
}

export type { ModelAsset };
