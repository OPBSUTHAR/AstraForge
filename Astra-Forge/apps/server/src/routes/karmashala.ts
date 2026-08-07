import { Router } from "express";
import { karmashala } from "../karmashala/index.js";

export const karmashalaRouter = Router();

karmashalaRouter.post("/", async (req, res, next) => {
  try {
    const { text } = req.body ?? {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    const result = await karmashala.run(text);
    res.json(result);
  } catch (error) {
    next(error);
  }
});