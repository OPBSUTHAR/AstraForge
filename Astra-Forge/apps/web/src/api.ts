import type {
  MeshFormat,
  ModelAsset,
  PipelineJob,
  Project,
  KarmashalaResult,
} from "@astraforge/shared";

export type { MeshFormat, ModelAsset, PipelineJob, Project, KarmashalaResult };

const API = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; service: string; uptime: number }>("/health"),

  listProjects: () => request<Project[]>("/projects"),
  createProject: (name: string) =>
    request<Project>("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),

  listAssets: () => request<ModelAsset[]>("/assets"),
  uploadImage: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("image", file);
    return request<ModelAsset>("/assets/upload", { method: "POST", body: form });
  },
  runVision: (assetId: string) =>
    request<PipelineJob>(`/assets/${assetId}/vision`, { method: "POST" }),

  listJobs: () => request<PipelineJob[]>("/jobs"),

  karmashala: (text: string) =>
    request<KarmashalaResult>("/karmashala", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }),
};

export { API };