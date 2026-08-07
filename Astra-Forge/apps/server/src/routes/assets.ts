import { Router } from "express";
import { assets } from "../data.js";
import { uploadImage } from "../services/storage.js";
import { runVisionJob } from "../services/vision.js";

export const assetsRouter = Router();

assetsRouter.get("/", async (_req, res) => {
  res.json(await assets.list());
});

assetsRouter.get("/:id", async (req, res) => {
  const asset = await assets.get(req.params.id);
  if (!asset) return res.status(404).json({ error: "asset not found" });
  res.json(asset);
});

assetsRouter.delete("/:id", async (req, res, next) => {
  try {
    const removed = await assets.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: "asset not found" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** Upload a 2D image as the seed for the vision pipeline. */
assetsRouter.post("/upload", uploadImage.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no image file provided" });
    const { projectId } = req.body ?? {};
    if (!projectId) return res.status(400).json({ error: "projectId is required" });
    const asset = await assets.create({
      projectId,
      name: req.file.originalname,
      source: "upload",
      format: "glb",
      path: req.file.filename,
      sourceImagePath: req.file.filename,
      status: "uploaded",
    });
    res.status(201).json(asset);
  } catch (error) {
    next(error);
  }
});

/** Kick off the vision pipeline for an uploaded image asset. */
assetsRouter.post("/:id/vision", async (req, res, next) => {
  try {
    const job = await runVisionJob(req.params.id);
    res.status(202).json(job);
  } catch (error) {
    next(error);
  }
});