import { Router } from "express";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { assets, projects } from "../data.js";
import { uploadImage } from "../services/storage.js";
import { runVisionJob } from "../services/vision.js";
import { emitAssetUpdate } from "../sockets.js";
import { TransformSchema, PaginationSchema } from "@astraforge/shared";
import { config } from "../config.js";

export const assetsRouter = Router();

assetsRouter.get("/", async (req, res, next) => {
  try {
    const { limit, offset } = PaginationSchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (typeof req.query.projectId === "string") filter.projectId = req.query.projectId;
    if (typeof req.query.status === "string") filter.status = req.query.status;
    const [items, total] = await Promise.all([assets.list({ limit, offset, filter }), assets.count(filter)]);
    res.json({ items, total, limit, offset });
  } catch (e) {
    next(e);
  }
});

assetsRouter.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const asset = await assets.get(id);
    if (!asset) return res.status(404).json({ error: "asset not found" });
    res.json(asset);
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(e);
  }
});

assetsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await assets.get(id);
    if (!existing) return res.status(404).json({ error: "asset not found" });
    // Remove files on disk (best-effort)
    for (const p of [existing.path, existing.sourceImagePath].filter(Boolean) as string[]) {
      const abs = path.join(existing.source === "vision" ? config.meshDir : config.uploadDir, path.basename(p));
      await fs.unlink(abs).catch(() => {});
    }
    await assets.remove(id);
    emitAssetUpdate({ id, deleted: true } as unknown as Record<string, unknown>);
    res.status(204).end();
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(error);
  }
});

assetsRouter.patch("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const existing = await assets.get(id);
    if (!existing) return res.status(404).json({ error: "asset not found" });
    const patch: Record<string, unknown> = {};
    const { transform, name } = req.body ?? {};
    if (transform !== undefined) {
      const parsed = TransformSchema.safeParse(transform);
      if (!parsed.success) return res.status(400).json({ error: "invalid transform", details: parsed.error.flatten() });
      patch.transform = parsed.data;
    }
    if (typeof name === "string" && name.trim()) {
      if (name.trim().length > 120) return res.status(400).json({ error: "name too long" });
      patch.name = name.trim().slice(0, 120);
    }
    const updated = await assets.update(id, patch as never);
    if (updated) emitAssetUpdate(updated as unknown as Record<string, unknown>);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(error);
  }
});

assetsRouter.post("/upload", uploadImage.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no image file provided" });
    const { projectId } = req.body ?? {};
    if (!projectId || typeof projectId !== "string") return res.status(400).json({ error: "projectId is required" });
    try {
      z.string().uuid().parse(projectId);
    } catch {
      return res.status(400).json({ error: "invalid projectId" });
    }
    const project = await projects.get(projectId);
    if (!project) return res.status(404).json({ error: "project not found" });

    const asset = await assets.create({
      projectId,
      name: req.file.originalname.slice(0, 120),
      source: "upload",
      format: "glb",
      path: req.file.filename,
      sourceImagePath: req.file.filename,
      status: "uploaded",
    });
    // add to project assetIds
    await projects.update(projectId, { assetIds: [...(project.assetIds ?? []), asset.id] } as never);
    res.status(201).json(asset);
  } catch (error) {
    next(error);
  }
});

assetsRouter.post("/:id/vision", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const asset = await assets.get(id);
    if (!asset) return res.status(404).json({ error: "asset not found" });
    const job = await runVisionJob(id);
    res.status(202).json(job);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    // runVisionJob already creates job, but if asset missing we handle
    const msg = (error as Error).message;
    if (msg.includes("already running")) return res.status(409).json({ error: msg });
    next(error);
  }
});
