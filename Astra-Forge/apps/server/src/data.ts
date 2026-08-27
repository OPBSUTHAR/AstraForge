import mongoose from "mongoose";
import type { PipelineJob, Project, ModelAsset } from "@astraforge/shared";
import { Store } from "./store.js";

// ─── Schemas ────────────────────────────────────────────────────────────────
const modelAssetSchema = new mongoose.Schema<ModelAsset>(
  {
    id: { type: String, required: true, unique: true, index: true },
    projectId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    source: { type: String, enum: ["upload", "vision", "geometry", "karmashala"], required: true },
    format: { type: String, required: true },
    path: { type: String, required: true },
    sourceImagePath: { type: String },
    meshUrl: { type: String },
    previewDataUrl: { type: String },
    status: { type: String, enum: ["uploaded", "queued", "processing", "ready", "failed"], default: "uploaded", index: true },
    stats: {
      vertices: Number,
      triangles: Number,
      watertight: Boolean,
    },
    transform: {
      position: [Number],
      rotation: [Number],
      scale: [Number],
    },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false, collection: "modelassets" },
);
modelAssetSchema.index({ projectId: 1, status: 1 });
modelAssetSchema.index({ createdAt: -1 });

const projectSchema = new mongoose.Schema<Project>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 500 },
    assetIds: { type: [String], default: [] },
    settings: {
      units: { type: String, enum: ["mm", "cm", "in"], default: "mm" },
      hologramColor: { type: String, default: "#00e5ff" },
    },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false, collection: "projects" },
);
projectSchema.index({ createdAt: -1 });

const jobSchema = new mongoose.Schema<PipelineJob>(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["vision", "mesh-gen", "geometry-repair", "split-joints"], required: true, index: true },
    status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued", index: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    output: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: String,
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false, collection: "pipelines" },
);
jobSchema.index({ status: 1, type: 1 });
jobSchema.index({ createdAt: -1 });

// ─── Stores (lazy via Store getter, safe to import before connect) ─────────
export const projects = new Store<Project>("Project", projectSchema);
export const assets = new Store<ModelAsset>("ModelAsset", modelAssetSchema);
export const jobs = new Store<PipelineJob>("PipelineJob", jobSchema);

export { Store };
export { modelAssetSchema, projectSchema, jobSchema };
