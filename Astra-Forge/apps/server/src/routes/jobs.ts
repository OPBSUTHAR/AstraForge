import { Router } from "express";
import { jobs } from "../data.js";

export const jobsRouter = Router();

jobsRouter.get("/", async (_req, res) => {
  res.json(await jobs.list());
});

jobsRouter.get("/:id", async (req, res) => {
  const job = await jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});