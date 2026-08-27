import type { ModelAsset, PipelineJob, Project, KarmashalaResult } from "@astraforge/shared";

const API = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
function unwrapPaginated<T>(data: T[] | Paginated<T>): T[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && "items" in data) return (data as Paginated<T>).items;
  return [];
}

export const api = {
  health: () => request<{ ok: boolean; service: string; uptime: number; storage: string }>("/health"),
  karmashalaHealth: () => request<{ ollama: string; model: string }>("/karmashala/health"),

  listProjects: async () => unwrapPaginated<Project>(await request<Paginated<Project> | Project[]>("/projects")),
  createProject: (name: string) =>
    request<Project>("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  listAssets: async (projectId?: string) => {
    const q = projectId ? `?projectId=${encodeURIComponent(projectId)}&limit=100` : "?limit=100";
    return unwrapPaginated<ModelAsset>(await request<Paginated<ModelAsset> | ModelAsset[]>(`/assets${q}`));
  },
  uploadImage: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("image", file);
    return request<ModelAsset>("/assets/upload", { method: "POST", body: form });
  },
  runVision: (assetId: string) => request<PipelineJob>(`/assets/${assetId}/vision`, { method: "POST" }),
  patchAsset: (assetId: string, patch: Record<string, unknown>) =>
    request<ModelAsset>(`/assets/${assetId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }),
  deleteAsset: (assetId: string) => request<void>(`/assets/${assetId}`, { method: "DELETE" }),

  listJobs: async () => unwrapPaginated<PipelineJob>(await request<Paginated<PipelineJob> | PipelineJob[]>("/jobs?limit=20")),

  karmashala: (text: string) =>
    request<KarmashalaResult>("/karmashala", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
};

export { API };
export type { ModelAsset, PipelineJob, Project, KarmashalaResult };
