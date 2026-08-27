import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { karmashala } from "../karmashala/index.js";

export const karmashalaRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

karmashalaRouter.post("/", limiter, async (req, res, next) => {
  try {
    const parsed = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const result = await karmashala.run(parsed.data.text);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

karmashalaRouter.get("/health", async (_req, res) => {
  // Proxy-friendly health check (web no longer calls Ollama directly)
  const { config } = await import("../config.js");
  try {
    const r = await fetch(`${config.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) });
    res.json({ ollama: r.ok ? "online" : `http_${r.status}`, model: config.ollamaModel });
  } catch (e) {
    res.json({ ollama: "offline", error: (e as Error).message, model: config.ollamaModel });
  }
});
