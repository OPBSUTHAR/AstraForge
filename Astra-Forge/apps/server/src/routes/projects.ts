import { Router } from "express";
import { z } from "zod";
import { projects, assets } from "../data.js";
import { CreateProjectSchema, UpdateProjectSchema, PaginationSchema } from "@astraforge/shared";

export const projectsRouter = Router();

projectsRouter.get("/", async (req, res, next) => {
  try {
    const { limit, offset } = PaginationSchema.parse(req.query);
    const [items, total] = await Promise.all([projects.list({ limit, offset }), projects.count()]);
    res.json({ items, total, limit, offset });
  } catch (e) {
    next(e);
  }
});

projectsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = CreateProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message, details: parsed.error.flatten() });
    const { name, description, settings } = parsed.data;
    const project = await projects.create({
      name: name.trim(),
      description: description?.trim() ?? "",
      assetIds: [],
      settings: { units: settings?.units ?? "mm", hologramColor: settings?.hologramColor ?? "#00e5ff" },
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

projectsRouter.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const project = await projects.get(id);
    if (!project) return res.status(404).json({ error: "project not found", code: "NOT_FOUND" });
    const projectAssets = await assets.list({ filter: { projectId: project.id }, limit: 100 });
    res.json({ ...project, assets: projectAssets });
  } catch (e) {
    // invalid uuid → 400
    if (e instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(e);
  }
});

projectsRouter.put("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const parsed = UpdateProjectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { name, description, settings } = parsed.data;
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (description !== undefined) patch.description = description.trim();
    if (settings !== undefined) patch.settings = settings;
    const updated = await projects.update(id, patch as never);
    if (!updated) return res.status(404).json({ error: "project not found" });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(error);
  }
});

projectsRouter.delete("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    // Cascade: delete assets belonging to project
    const projectAssets = await assets.list({ filter: { projectId: id }, limit: 100 });
    for (const a of projectAssets) await assets.remove(a.id);
    const removed = await projects.remove(id);
    if (!removed) return res.status(404).json({ error: "project not found" });
    res.status(204).end();
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(error);
  }
});
