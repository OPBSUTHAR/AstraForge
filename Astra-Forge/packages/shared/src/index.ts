export type MeshFormat = "glb" | "gltf" | "obj" | "stl" | "ply";

export type AssetStatus = "uploaded" | "queued" | "processing" | "ready" | "failed";

/** A 3D model asset inside a project (uploaded, AI-generated, or engineered). */
export interface ModelAsset {
  id: string;
  projectId: string;
  name: string;
  source: "upload" | "vision" | "geometry" | "karmashala";
  format: MeshFormat;
  /** Relative path on the server (storage/meshes/... or storage/uploads/...). */
  path: string;
  /** Original 2D image path when generated from a photo. */
  sourceImagePath?: string;
  /** Absolute URL the browser can use to fetch the mesh file. */
  meshUrl?: string;
  /** Small inline thumbnail (data URL) of the source image. */
  previewDataUrl?: string;
  status: AssetStatus;
  /** Vertex / triangle counts after processing, if known. */
  stats?: {
    vertices: number;
    triangles: number;
    watertight?: boolean;
  };
  /** Free holographic placement (set + driven from the UI). */
  transform?: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  };
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  assetIds: string[];
  settings: {
    units: "mm" | "cm" | "in";
    hologramColor: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type JobType = "vision" | "mesh-gen" | "geometry-repair" | "split-joints";

export type JobStatus = "queued" | "running" | "done" | "failed";

/** Long-running pipeline job (vision, geometry, ...) tracked by the orchestrator. */
export interface PipelineJob {
  id: string;
  type: JobType;
  status: JobStatus;
  /** 0-100 progress reported by the executing service. */
  progress: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Result of a Karmashala natural-language command. */
export interface KarmashalaResult {
  ok: boolean;
  intent: string;
  action?: string;
  output: string;
  jobId?: string;
}

/** Socket.IO events emitted by the server. */
export interface ServerToClientEvents {
  "job:update": (job: PipelineJob) => void;
  "asset:update": (asset: ModelAsset) => void;
  "karmashala:log": (entry: { timestamp: string; level: string; message: string }) => void;
  "scene:command": (cmd: {
    action: "spawn" | "mutate" | "redesign" | "select" | "delete";
    target?: string;
    payload?: Record<string, unknown>;
    text?: string;
  }) => void;
}

export interface ClientToServerEvents {
  "job:subscribe": (jobId: string) => void;
  "karmashala:command": (text: string) => void;
  "scene:command": (cmd: ServerToClientEvents["scene:command"]) => void;
}

/** Vision pipeline (Phase 2) request/response contracts. */
export interface VisionRequest {
  imagePath: string;
  /** rembg | none */
  backgroundRemoval: "rembg" | "none";
  /** mesh generator: trellis | sf3d */
  generator: "trellis" | "sf3d";
  outputFormat: "glb" | "obj";
}

export interface VisionResponse {
  meshPath: string;
  meshFormat: MeshFormat;
  stats: { vertices: number; triangles: number };
  elapsedMs: number;
}
