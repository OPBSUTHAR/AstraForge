import { Router } from "express";
import { z } from "zod";
import { jobs } from "../data.js";
import { PaginationSchema } from "@astraforge/shared";

export const jobsRouter = Router();

jobsRouter.get("/", async (req, res, next) => {
  try {
    const { limit, offset } = PaginationSchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === "string") filter.status = req.query.status;
    if (typeof req.query.type === "string") filter.type = req.query.type;
    const [items, total] = await Promise.all([jobs.list({ limit, offset, filter }), jobs.count(filter)]);
    // Strip absolute paths from output
    const sanitized = items.map((j) => ({ ...j, input: sanitize(j.input), output: j.output ? sanitize(j.output) : undefined }));
    res.json({ items: sanitized, total, limit, offset });
  } catch (e) {
    next(e);
  }
});

jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const job = await jobs.get(id);
    if (!job) return res.status(404).json({ error: "job not found" });
    res.json({ ...job, input: sanitize(job.input), output: job.output ? sanitize(job.output) : undefined });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: "invalid id" });
    next(e);
  }
});

function sanitize(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string" && (k.toLowerCase().includes("path") || v.includes(":\\") || v.startsWith("/"))) {
      out[k] = v.split(/[\\/]/).pop();
    } else {
      out[k] = v;
    }
  }
  return out;
}
