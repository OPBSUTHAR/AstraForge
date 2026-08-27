import { z } from "zod";

// ─── Versioning ──────────────────────────────────────────────────────────────
export const ASTRAFORGE_VERSION = "0.2.0" as const;
export const API_VERSION = "v1" as const;

// ─── Primitives ─────────────────────────────────────────────────────────────
export type MeshFormat = "glb" | "gltf" | "obj" | "stl" | "ply";
export const MeshFormatSchema = z.enum(["glb", "gltf", "obj", "stl", "ply"]);

export type AssetStatus = "uploaded" | "queued" | "processing" | "ready" | "failed";
export const AssetStatusSchema = z.enum(["uploaded", "queued", "processing", "ready", "failed"]);

export type AssetSource = "upload" | "vision" | "geometry" | "karmashala";
export const AssetSourceSchema = z.enum(["upload", "vision", "geometry", "karmashala"]);

export type JobType = "vision" | "mesh-gen" | "geometry-repair" | "split-joints";
export const JobTypeSchema = z.enum(["vision", "mesh-gen", "geometry-repair", "split-joints"]);

export type JobStatus = "queued" | "running" | "done" | "failed";
export const JobStatusSchema = z.enum(["queued", "running", "done", "failed"]);

export type Units = "mm" | "cm" | "in";
export const UnitsSchema = z.enum(["mm", "cm", "in"]);

// ─── Transform (holographic placement) ─────────────────────────────────────
export const TransformSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  rotation: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  scale: z.tuple([z.number().positive().finite(), z.number().positive().finite(), z.number().positive().finite()]),
});
export type Transform = z.infer<typeof TransformSchema>;

// ─── ModelAsset ─────────────────────────────────────────────────────────────
export const ModelAssetSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
  source: AssetSourceSchema,
  format: MeshFormatSchema,
  path: z.string().min(1),
  sourceImagePath: z.string().optional(),
  meshUrl: z.string().optional(),
  previewDataUrl: z.string().optional(),
  status: AssetStatusSchema,
  stats: z
    .object({
      vertices: z.number().int().nonnegative(),
      triangles: z.number().int().nonnegative(),
      watertight: z.boolean().optional(),
    })
    .optional(),
  transform: TransformSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ModelAsset = z.infer<typeof ModelAssetSchema>;

export const CreateAssetSchema = ModelAssetSchema.omit({ id: true, createdAt: true, updatedAt: true });
export const UpdateAssetSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: AssetStatusSchema.optional(),
  transform: TransformSchema.optional(),
  stats: ModelAssetSchema.shape.stats.optional(),
});

// ─── Project ─────────────────────────────────────────────────────────────────
export const ProjectSettingsSchema = z.object({
  units: UnitsSchema.default("mm"),
  hologramColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#00e5ff"),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  assetIds: z.array(z.string().uuid()).default([]),
  settings: ProjectSettingsSchema.default({ units: "mm", hologramColor: "#00e5ff" }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  settings: ProjectSettingsSchema.partial().optional(),
});
export const UpdateProjectSchema = CreateProjectSchema.partial();

// ─── Pipeline Job ────────────────────────────────────────────────────────────
export const PipelineJobSchema = z.object({
  id: z.string().uuid(),
  type: JobTypeSchema,
  status: JobStatusSchema,
  progress: z.number().int().min(0).max(100),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PipelineJob = z.infer<typeof PipelineJobSchema>;

// ─── Karmashala ──────────────────────────────────────────────────────────────
export const KarmashalaIntentSchema = z.enum([
  "status",
  "list-projects",
  "list-assets",
  "vision",
  "redesign",
  "scene-mutate",
  "scene-spawn",
  "scene-select",
  "scene-delete",
  "geometry-split",
  "geometry-repair",
  "help",
  "unknown",
]);

export const KarmashalaResultSchema = z.object({
  ok: z.boolean(),
  intent: z.string(),
  action: z.enum(["scene:mutate", "scene:spawn", "scene:redesign", "scene:select", "scene:delete"]).optional(),
  output: z.string(),
  jobId: z.string().uuid().optional(),
});
export type KarmashalaResult = z.infer<typeof KarmashalaResultSchema>;

// ─── Socket Contracts ───────────────────────────────────────────────────────
export type SceneAction = "spawn" | "mutate" | "redesign" | "select" | "delete";

export interface ServerToClientEvents {
  "job:update": (job: PipelineJob) => void;
  "asset:update": (asset: ModelAsset) => void;
  "karmashala:log": (entry: { timestamp: string; level: "info" | "warn" | "error"; message: string }) => void;
  "scene:command": (cmd: { action: SceneAction; target?: string; payload?: Record<string, unknown>; text?: string }) => void;
}
export interface ClientToServerEvents {
  "job:subscribe": (jobId: string) => void;
  "karmashala:command": (text: string) => void;
  "scene:command": (cmd: { action: SceneAction; target?: string; payload?: Record<string, unknown>; text?: string }) => void;
}

export const SceneCommandSchema = z.object({
  action: z.enum(["spawn", "mutate", "redesign", "select", "delete"]),
  target: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  text: z.string().max(1000).optional(),
});
export type SceneCommand = z.infer<typeof SceneCommandSchema>;

// ─── Vision Pipeline ────────────────────────────────────────────────────────
export const VisionGeneratorSchema = z.enum(["trellis", "sf3d", "procedural"]);
export const VisionBackgroundSchema = z.enum(["rembg", "none"]);

export const VisionRequestSchema = z.object({
  imagePath: z.string().min(1).optional(),
  srcPath: z.string().min(1).optional(),
  backgroundRemoval: VisionBackgroundSchema.default("none"),
  generator: VisionGeneratorSchema.default("procedural"),
  outputFormat: z.enum(["glb", "obj"]).default("obj"),
});
// Align with actual server→python contract (both keys accepted).
export type VisionRequest = z.infer<typeof VisionRequestSchema> & { imagePath?: string; srcPath?: string };

export const VisionResponseSchema = z.object({
  meshPath: z.string(),
  meshFormat: MeshFormatSchema,
  stats: z.object({ vertices: z.number().int().nonnegative(), triangles: z.number().int().nonnegative() }),
  elapsedMs: z.number().nonnegative(),
  previewDataUrl: z.string().optional(),
});
export type VisionResponse = z.infer<typeof VisionResponseSchema>;

// ─── Geometry ────────────────────────────────────────────────────────────────
export const GeometryOperationSchema = z.enum(["repair", "split-joints", "info"]);
export const GeometryRequestSchema = z.object({
  operation: GeometryOperationSchema,
  inputPath: z.string().min(1),
  outputPath: z.string().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});
export type GeometryRequest = z.infer<typeof GeometryRequestSchema>;

export const GeometryResponseSchema = z.object({
  outputPath: z.string(),
  stats: z.object({ vertices: z.number().int().nonnegative(), triangles: z.number().int().nonnegative(), watertight: z.boolean().optional() }).optional(),
  elapsedMs: z.number().nonnegative(),
});
export type GeometryResponse = z.infer<typeof GeometryResponseSchema>;

// ─── API envelope ───────────────────────────────────────────────────────────
export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof PaginationSchema>;

// Re-export zod for convenience
export { z };
