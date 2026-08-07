import mongoose from "mongoose";
import type { PipelineJob, Project, ModelAsset } from "@astraforge/shared";

const modelAssetSchema = new mongoose.Schema<ModelAsset>({
  projectId: { type: String, required: true },
  name: { type: String, required: true },
  source: { type: String, enum: ["upload", "vision", "geometry", "karmashala"], required: true },
  format: { type: String, required: true },
  path: { type: String, required: true },
  sourceImagePath: { type: String },
  status: { type: String, enum: ["uploaded", "queued", "processing", "ready", "failed"], default: "uploaded" },
  stats: {
    vertices: Number,
    triangles: Number,
    watertight: Boolean,
  },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});

const projectSchema = new mongoose.Schema<Project>({
  name: { type: String, required: true },
  description: String,
  assetIds: { type: [String], default: [] },
  settings: {
    units: { type: String, enum: ["mm", "cm", "in"], default: "mm" },
    hologramColor: { type: String, default: "#00e5ff" },
  },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});

const jobSchema = new mongoose.Schema({
  type: { type: String, enum: ["vision", "mesh-gen", "geometry-repair", "split-joints"], required: true },
  status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
  progress: { type: Number, default: 0 },
  input: { type: mongoose.Schema.Types.Mixed, default: {} },
  output: { type: mongoose.Schema.Types.Mixed, default: {} },
  error: String,
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});

export { projectSchema, modelAssetSchema, jobSchema };

export { Store } from "./store.js";
import { Store } from "./store.js";

export const projects = new Store<Project>("Project", projectSchema);
export const assets = new Store<ModelAsset>("ModelAsset", modelAssetSchema);
export const jobs = new Store<PipelineJob>("PipelineJob", jobSchema);