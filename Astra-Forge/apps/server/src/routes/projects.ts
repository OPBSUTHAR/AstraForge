import { Router } from "express";
import { projects, assets } from "../data.js";
import type { Project } from "@astraforge/shared";

export const projectsRouter = Router();

projectsRouter.get("/", async (_req, res) => {
  res.json(await projects.list());
});

projectsRouter.post("/", async (req, res, next) => {
  try {
    const { name, description, settings } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name is required" });
    const project = await projects.create({
      name,
      description: description ?? "",
      assetIds: [],
      settings: {
        units: settings?.units ?? "mm",
        hologramColor: settings?.hologramColor ?? "#00e5ff",
      },
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

projectsRouter.get("/:id", async (req, res) => {
  const project = await projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: "project not found" });
  const projectAssets = await assets.list();
  res.json({
    ...project,
    assets: projectAssets.filter((a) => a.projectId === project.id),
  });
});

projectsRouter.put("/:id", async (req, res, next) => {
  try {
    const patch = req.body ?? {};
    const { name, description, settings } = patch as Partial<Project>;
    const updated = await projects.update(req.params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(settings !== undefined ? { settings } : {}),
    });
    if (!updated) return res.status(404).json({ error: "project not found" });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

projectsRouter.delete("/:id", async (req, res, next) => {
  try {
    const removed = await projects.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: "project not found" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});