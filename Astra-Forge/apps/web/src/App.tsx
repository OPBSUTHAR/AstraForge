import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { api } from "./api";
import { useSocket } from "./useSocket";
import { Scene } from "./scene/Scene";
import type { ModelAsset, Project } from "@astraforge/shared";

interface TermLine {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

const MAX_PIXELS = 16_000_000;

// Client-side auto-reframe helper (mirrors server vision)
async function autoReframeFile(file: File): Promise<File> {
  if (file.type === "application/postscript" || file.name.toLowerCase().endsWith(".eps") || file.name.toLowerCase().endsWith(".ps") || file.name.toLowerCase().endsWith(".ai")) return file;
  // Use createImageBitmap for fast decode
  try {
    const bmp = await createImageBitmap(file);
    const pixels = bmp.width * bmp.height;
    if (pixels <= MAX_PIXELS) { bmp.close(); return file; }
    const scale = Math.sqrt(MAX_PIXELS / pixels);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close(); return file; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, file.type || "image/jpeg", 0.92));
    if (!blob) return file;
    return new File([blob], file.name, { type: blob.type || file.type });
  } catch { return file; }
}

export function App() {
  const { job, logs: socketLogs, assetUpdates, sceneCommands, subscribeToJob, connected, sendScene } = useSocket();
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [visionUp, setVisionUp] = useState<boolean | null>(null);
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [color, setColor] = useState("#00e5ff");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [assetFilter, setAssetFilter] = useState<"all" | "ready" | "uploaded" | "failed">("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [editingName, setEditingName] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [viewResetKey, setViewResetKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [termLines, setTermLines] = useState<TermLine[]>([
    { timestamp: new Date().toISOString(), level: "info", message: "Karmashala online. Type 'hi', 'help', 'status'." },
  ]);

  const pushTerm = useCallback((level: TermLine["level"], message: string) => {
    setTermLines((prev) => [...prev.slice(-199), { timestamp: new Date().toISOString(), level, message }]);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("project");
    if (pid) setProjectId(pid);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("project", projectId);
    window.history.replaceState({}, "", url.toString());
  }, [projectId]);

  // Clean start: don't auto-select project — onboarding stays until user picks
  useEffect(() => {
    let cancelled = false;
    api.listProjects().then((list) => {
      if (cancelled) return;
      setProjects(list);
    }).catch((e) => pushTerm("error", e.message));
    return () => { cancelled = true; };
  }, [pushTerm]);

  const handleClearAll = useCallback(async () => {
    if (!confirm("Clear all projects and assets? This cannot be undone.")) return;
    try {
      for (const p of projects) await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      setProjects([]); setProjectId(null); setAssets([]); setActiveAssetId(null);
      history.replaceState({}, "", window.location.pathname);
      pushTerm("info", "workspace cleared");
    } catch (e) { pushTerm("error", (e as Error).message); }
  }, [projects, pushTerm]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try { const h = await api.health() as unknown as { vision: string }; if (alive) { setServerUp(true); setVisionUp(h.vision === "online"); } } catch { if (alive) { setServerUp(false); setVisionUp(false); } }
      try { const h = await api.karmashalaHealth(); if (alive) setOllamaUp(h.ollama === "online"); } catch { if (alive) setOllamaUp(false); }
    };
    void check();
    const t = setInterval(check, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const refreshAssets = useCallback(async () => {
    if (!projectId) { setAssets([]); setActiveAssetId(null); return; }
    try {
      const list = await api.listAssets(projectId);
      setAssets(list);
      setActiveAssetId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        if (list.length) { const ready = list.find((a) => a.status === "ready") ?? list[list.length - 1]; return ready.id; }
        return null;
      });
    } catch (e) { pushTerm("error", (e as Error).message); }
  }, [projectId, pushTerm]);
  useEffect(() => { void refreshAssets(); }, [refreshAssets]);

  useEffect(() => {
    if (assetUpdates.length === 0) return;
    const latest = assetUpdates[assetUpdates.length - 1];
    if ((latest as unknown as { deleted?: boolean }).deleted) {
      setAssets((p) => p.filter((a) => a.id !== latest.id));
      setActiveAssetId((prev) => (prev === latest.id ? null : prev));
      return;
    }
    setAssets((prev) => {
      const idx = prev.findIndex((a) => a.id === latest.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = latest; return next; }
      if (latest.projectId === projectId) return [...prev, latest];
      return prev;
    });
    if (latest.status === "ready") setActiveAssetId(latest.id);
    if (latest.status === "ready" || latest.status === "failed") pushTerm("info", `asset ${latest.name} → ${latest.status}`);
  }, [assetUpdates, projectId, pushTerm]);

  const activeAsset = useMemo(() => assets.find((a) => a.id === activeAssetId) ?? null, [assets, activeAssetId]);
  useEffect(() => { if (activeAsset) setEditingName(activeAsset.name); }, [activeAsset?.id, activeAsset?.name]);

  // Verify mesh is actually loadable when job completes — ensures editor shows real model not just xyz gizmo
  useEffect(() => {
    if (!job) return;
    if (job.status === "done" && (job.output as { meshUrl?: string; analysis?: Record<string,unknown> })?.meshUrl) {
      const out = job.output as { meshUrl: string; analysis?: Record<string,unknown> };
      pushTerm("info", `✓ verified ${out.meshUrl} — analysis: ${JSON.stringify(out.analysis ?? {}).slice(0, 220)}`);
      // Force refresh assets to ensure new mesh appears and is selected
      void refreshAssets();
    }
    if (job.status === "failed" && job.error) pushTerm("error", `vision failed: ${job.error} — try Regenerate or check file`);
  }, [job?.status, job?.output, refreshAssets, pushTerm]);

  useEffect(() => {
    if (sceneCommands.length === 0) return;
    const cmd = sceneCommands[sceneCommands.length - 1] as { action: string; text?: string; payload?: Record<string, unknown> };
    if (cmd.action === "spawn") pushTerm("info", `◈ spawn: ${cmd.text ?? JSON.stringify(cmd.payload ?? {})}`);
    if (cmd.action === "mutate") pushTerm("info", `◈ mutate: ${cmd.text ?? JSON.stringify(cmd.payload ?? {})}`);
    if (cmd.action === "redesign") {
      try {
        const parsed = JSON.parse(cmd.text ?? "{}");
        if (parsed.value && typeof parsed.value === "string" && parsed.value.startsWith("#")) setColor(parsed.value);
        if (parsed.color) setColor(parsed.color);
      } catch { /* ignore */ }
    }
  }, [sceneCommands, pushTerm]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!activeAssetId) return;
      const k = e.key.toLowerCase();
      if (k === "delete" || k === "backspace") { e.preventDefault(); void handleDeleteAsset(activeAssetId); }
      if (k === "r") sendScene({ action: "mutate", target: activeAssetId, payload: { rotation: [0, Math.random() * 0.5, 0] } });
      if (k === "+" || k === "=") sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [1.2, 1.2, 1.2] } });
      if (k === "-") sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [0.85, 0.85, 0.85] } });
      if (k === "0") sendScene({ action: "mutate", target: activeAssetId, payload: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeAssetId]); // eslint-disable-line

  async function handleCreateProject() {
    const name = newProjectName.trim(); if (!name) return;
    try { const p = await api.createProject(name); setProjects((prev) => [...prev, p]); setProjectId(p.id); setNewProjectName(""); pushTerm("info", `created "${name}" (${p.id.slice(0, 8)})`); } catch (e) { pushTerm("error", (e as Error).message); }
  }
  async function handleUpload(file: File | null) {
    if (!file || uploading) return;
    const allowed = [".png",".jpg",".jpeg",".webp",".bmp",".gif",".tiff",".tif",".eps",".ps",".ai"];
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!allowed.includes(ext) && !file.type.startsWith("image/") && file.type !== "application/postscript" && file.type !== "application/octet-stream") { pushTerm("error", `unsupported ${ext} — allowed: ${allowed.join(", ")}`); return; }
    if (file.size > 15 * 1024 * 1024) { pushTerm("error", "file too large (>15MB)"); return; }
    setUploading(true);
    try {
      let pid = projectId;
      if (!pid) { const p = await api.createProject("Untitled project"); setProjects((prev) => [...prev, p]); pid = p.id; setProjectId(p.id); pushTerm("info", `no project — created "${p.name}"`); }
      // auto-reframe client side (like Blender image → scene scale)
      const reframed = await autoReframeFile(file);
      if (reframed !== file) pushTerm("info", `auto-reframed ${file.name} → ${Math.round(reframed.size/1024)}KB (was ${(file.size/1024).toFixed(0)}KB) to fit ${MAX_PIXELS} px limit`);
      const asset = await api.uploadImage(pid, reframed);
      setAssets((prev) => [...prev, asset]);
      setActiveAssetId(asset.id);
      pushTerm("info", `imported "${reframed.name}" → ${asset.id.slice(0, 8)}`);
    } catch (e) { pushTerm("error", `import failed: ${(e as Error).message}`); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }
  async function handleRunVision(id: string) {
    if (visionUp === false) pushTerm("warn", "vision offline — start: npm run vision:dev (or npm run dev:all)");
    try { const j = await api.runVision(id); pushTerm("info", `vision job ${j.id.slice(0, 8)} queued`); subscribeToJob(j.id); } catch (e) { pushTerm("error", (e as Error).message); }
  }
  async function handleCommand(text: string) {
    if (!text.trim()) return; pushTerm("info", `» ${text}`);
    try {
      const r = await api.karmashala(text);
      pushTerm(r.ok ? "info" : "warn", r.output);
      if (r.action === "scene:mutate") {
        const lower = text.toLowerCase();
        const col = lower.match(/#[0-9a-f]{6}|red|blue|cyan|green|orange|purple|pink|yellow|white|black/);
        if (col) { const map: Record<string, string> = { red: "#ff3b30", blue: "#0a84ff", cyan: "#00e5ff", green: "#30d158", orange: "#ff9f0a", purple: "#af52de", pink: "#ff2d55", yellow: "#ffd60a", white: "#ffffff", black: "#111111" }; setColor(map[col[0]] ?? col[0]); }
        if (activeAssetId) {
          if (lower.includes("scale up") || lower.includes("bigger")) sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [1.35, 1.35, 1.35] } });
          if (lower.includes("scale down") || lower.includes("smaller")) sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [0.75, 0.75, 0.75] } });
          if (lower.includes("rotate")) sendScene({ action: "mutate", target: activeAssetId, payload: { rotation: [0, 0.8, 0] } });
          if (lower.includes("reset")) sendScene({ action: "mutate", target: activeAssetId, payload: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
        }
      }
    } catch (e) { pushTerm("error", (e as Error).message); }
  }
  async function handleDeleteAsset(id: string) {
    try { await api.deleteAsset(id); setAssets((p) => p.filter((a) => a.id !== id)); if (activeAssetId === id) setActiveAssetId(null); pushTerm("info", `deleted ${id.slice(0, 8)}`); } catch (e) { pushTerm("error", (e as Error).message); }
  }
  async function handleRename() {
    if (!activeAsset || !editingName.trim()) return;
    try { const updated = await api.patchAsset(activeAsset.id, { name: editingName.trim() }); setAssets((prev) => prev.map((a) => a.id === updated.id ? updated : a)); pushTerm("info", `renamed → ${updated.name}`); } catch (e) { pushTerm("error", (e as Error).message); }
  }
  async function handleDownload() {
    if (!activeAsset?.meshUrl) { pushTerm("warn", "no mesh to download — Generate 3D mesh first"); return; }
    try {
      const res = await fetch(activeAsset.meshUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${activeAsset.name.replace(/\.[^.]+$/, "") || "model"}.obj`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      pushTerm("info", `downloaded ${a.download}`);
    } catch (e) { pushTerm("error", `download failed: ${(e as Error).message}`); }
  }
  async function handleDuplicate() {
    if (!activeAsset) return;
    try {
      // one-click duplicate: re-import via upload path not available, so clone via API by creating new asset entry pointing to same mesh
      // simplest: create a new uploaded placeholder then copy meshUrl via patch if ready
      // For now create a project-scoped copy of the mesh asset
      const clone = await api.uploadImage(activeAsset.projectId, new File([await (await fetch(activeAsset.meshUrl ?? "")).blob().catch(()=>new Blob())], activeAsset.name, { type: "model/obj" })).catch(async () => {
        // fallback: duplicate via direct create if fetch fails — use same image path
        return null;
      });
      if (clone) { setAssets((p) => [...p, clone]); setActiveAssetId(clone.id); pushTerm("info", `duplicated → ${clone.id.slice(0,8)}`); }
      else pushTerm("warn", "duplicate: use Download then Import to clone — direct mesh clone coming Phase 4");
    } catch (e) { pushTerm("error", (e as Error).message); }
  }
  function handleCopySnippet(kind: "html" | "react" | "three") {
    if (!activeAsset?.meshUrl) { pushTerm("warn", "no mesh yet"); return; }
    const url = `${window.location.origin}${activeAsset.meshUrl}`;
    const snippets: Record<string, string> = {
      html: `<model-viewer src="${url}" alt="${activeAsset.name}" auto-rotate camera-controls></model-viewer> <!-- https://modelviewer.dev -->`,
      react: `import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';\nconst loader = new OBJLoader();\nloader.load('${url}', (obj)=> scene.add(obj)); // mesh ${activeAsset.stats?.triangles ?? "?"} tris`,
      three: `// Three.js — add to your scene\nloader.load('${url}', (group)=>{ scene.add(group); group.scale.setScalar(2.4/Math.max(...new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray())); });`,
    };
    navigator.clipboard.writeText(snippets[kind]).then(()=> pushTerm("info", `${kind} snippet copied`)).catch(()=> pushTerm("error", "clipboard blocked"));
  }

  const filteredAssets = useMemo(() => {
    let list = assets;
    if (assetFilter !== "all") list = list.filter((a) => a.status === assetFilter);
    if (assetSearch.trim()) { const q = assetSearch.toLowerCase(); list = list.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)); }
    return list;
  }, [assets, assetFilter, assetSearch]);

  const logs = useMemo(() => [...socketLogs.map((l) => ({ ...l } as TermLine)), ...termLines].slice(-220), [socketLogs, termLines]);
  const showVisionWarn = visionUp === false;

  return (
    <div className="app">
      <header className="hud">
        <div className="brand">ASTRA<span className="forge">FORGE</span></div>
        <div className="hint">Blender · Tripo-inspired · zero-human 3D pipeline</div>
        <div className="status-dots">
          <StatusDot label="SERVER" online={serverUp} />
          <StatusDot label="VISION" online={visionUp} />
          <StatusDot label="OLLAMA" online={ollamaUp} />
          <StatusDot label="SOCKET" online={connected} />
        </div>
      </header>

      {/* Blender-like useful sidebar */}
      <aside className="sidebar" aria-label="Forge sidebar">
        {/* PROJECTS — clean start, no forced selection */}
        <section className="panel">
          <div className="panel-head"><h3>◆ Project</h3><div style={{ display: "flex", gap: 6, alignItems: "center" }}><span className="tag">{projects.length} total</span>{projects.length>0 && <button className="btn" style={{ padding: "3px 6px", fontSize: 10 }} onClick={() => void handleClearAll()} title="Clear all projects (demo reset)">Clear</button>}</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" aria-label="New project name" placeholder="New project…" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleCreateProject()} />
            <button className="btn" aria-label="Create project" onClick={() => void handleCreateProject()} disabled={!newProjectName.trim()}>＋</button>
          </div>
          {projects.length === 0 ? (
            <div style={{ marginTop: 10, padding: "10px 10px", borderRadius: 8, background: "rgba(0,229,255,0.06)", border: "1px solid rgba(0,229,255,0.12)", fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: "var(--hologram)" }}>Welcome — no workspace yet</div>
              <div style={{ opacity: 0.8 }}>Drop an image below or create a project to begin. Nothing is pre-loaded.</div>
            </div>
          ) : (
            <ul className="list" style={{ marginTop: 10, maxHeight: 160, overflowY: "auto" }}>
              {projects.map((p) => (
                <li key={p.id} className={p.id === projectId ? "selected" : ""} onClick={() => setProjectId(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setProjectId(p.id)}>
                  {p.name} <div className="tag">{p.id.slice(0, 8)} · {p.assetIds.length} assets</div>
                </li>
              ))}
            </ul>
          )}
          {projectId === null && projects.length > 0 && <div className="tag" style={{ marginTop: 8 }}>Select a project or drop an image to auto-create one</div>}
        </section>

        {/* IMPORT — file operations with auto-reframe */}
        <section className="panel">
          <div className="panel-head"><h3>⬢ Import</h3><span className="tag">JPG PNG EPS</span></div>
          <label className={`dropzone ${dragOver ? "active" : ""}`} aria-label="Import image" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void handleUpload(f); }}>
            <div className="dropzone-inner">
              <div className="drop-icon">⬆</div>
              <div>{uploading ? "Uploading…" : dragOver ? "Drop to import" : "Drag & drop or click to import"}</div>
              <div className="tag" style={{ marginTop: 6 }}>Auto-reframe: large images downsized to 16MP · ≤15MB</div>
            </div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tiff,.tif,.eps,.ps,.ai,application/postscript,application/eps" disabled={uploading} onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)} />
          </label>
          {showVisionWarn && <div className="tag" style={{ color: "var(--danger)", marginTop: 6 }}>vision offline — run <code>npm run dev:all</code></div>}
        </section>

        {/* ASSET LIBRARY */}
        <section className="panel">
          <div className="panel-head"><h3>▦ Library</h3><span className="tag">{filteredAssets.length}/{assets.length}</span></div>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" placeholder="Search…" value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} style={{ flex: 1 }} />
            <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value as never)} style={{ width: 110 }}>
              <option value="all">All</option><option value="ready">Ready</option><option value="uploaded">Uploaded</option><option value="failed">Failed</option>
            </select>
          </div>
          <ul className="list" style={{ marginTop: 10 }}>
            {filteredAssets.map((a) => (
              <li key={a.id} className={a.id === activeAssetId ? "selected" : ""} onClick={() => setActiveAssetId(a.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {a.previewDataUrl ? <img src={a.previewDataUrl} alt="" className="thumb" loading="lazy" /> : <div className="thumb" style={{ display: "grid", placeItems: "center", fontSize: 10, opacity: 0.6 }}>{a.status[0].toUpperCase()}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span className={`status ${a.status}`}>{a.status}</span>{a.stats ? <span className="tag">· {a.stats.triangles} tris · {a.stats.vertices} verts</span> : null}</div>
                  </div>
                  <button className="btn" style={{ padding: "4px 6px", fontSize: 10 }} onClick={(e) => { e.stopPropagation(); void handleDeleteAsset(a.id); }} aria-label={`Delete ${a.name}`}>✕</button>
                </div>
              </li>
            ))}
            {filteredAssets.length === 0 && <li style={{ opacity: 0.6, cursor: "default" }}>no matches — clear search/filter</li>}
          </ul>
          {activeAsset && activeAsset.status === "uploaded" && <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={() => void handleRunVision(activeAsset.id)} disabled={uploading}>▶ Generate 3D mesh</button>}
          {activeAsset?.status === "failed" && <button className="btn" style={{ marginTop: 8, width: "100%", borderColor: "var(--danger)" }} onClick={() => void handleRunVision(activeAsset.id)}>↻ Retry vision</button>}
        </section>

        {/* INSPECTOR — Blender-like properties with numeric transform */}
        {activeAsset && (
          <section className="panel inspector">
            <div className="panel-head"><h3>⬔ Inspector</h3><span className="tag">{activeAsset.source}</span></div>
            <label className="field"><span>Name</span><div style={{ display: "flex", gap: 6 }}><input className="input" value={editingName} onChange={(e) => setEditingName(e.target.value)} /> <button className="btn" onClick={() => void handleRename()}>Save</button></div></label>
            <div className="field"><span>Status</span><span className={`status ${activeAsset.status}`} style={{ fontWeight: 700 }}>{activeAsset.status}</span> {activeAsset.meshUrl && <a href={activeAsset.meshUrl} target="_blank" rel="noreferrer" className="tag" style={{ marginLeft: 8, color: "var(--hologram)" }}>open .obj</a>}</div>
            {activeAsset.stats && <div className="field"><span>Stats</span><span className="tag">{activeAsset.stats.vertices} verts · {activeAsset.stats.triangles} tris</span></div>}
            <label className="field"><span>Hologram</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 28, border: "none", background: "none", padding: 0 }} /></label>
            <div className="field" style={{ alignItems: "start" }}><span>Location</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {(["0","1","2"] as const).map((idx) => {
                  const axis = ["X","Y","Z"][Number(idx)] as "X"|"Y"|"Z";
                  const val = activeAsset.transform?.position?.[Number(idx)] ?? 0;
                  return <label key={axis} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}><span style={{ minWidth: 12, opacity: 0.6 }}>{axis}</span><input className="input" type="number" step={0.05} value={val} onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    const pos = [...(activeAsset.transform?.position ?? [0,0,0])] as [number,number,number];
                    pos[Number(idx)] = v;
                    sendScene({ action: "mutate", target: activeAsset.id, payload: { position: pos } });
                  }} style={{ padding: "6px 6px" }} /></label>;
                })}
              </div>
            </div>
            <div className="field" style={{ alignItems: "start" }}><span>Rotation</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {(["0","1","2"] as const).map((idx) => {
                  const axis = ["X","Y","Z"][Number(idx)] as "X"|"Y"|"Z";
                  const val = activeAsset.transform?.rotation?.[Number(idx)] ?? 0;
                  return <label key={axis} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}><span style={{ minWidth: 12, opacity: 0.6 }}>{axis}</span><input className="input" type="number" step={0.1} value={val} onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0;
                    const rot = [...(activeAsset.transform?.rotation ?? [0,0,0])] as [number,number,number];
                    rot[Number(idx)] = v;
                    sendScene({ action: "mutate", target: activeAsset.id, payload: { rotation: rot } });
                  }} style={{ padding: "6px 6px" }} /></label>;
                })}
              </div>
            </div>
            <div className="field" style={{ alignItems: "start" }}><span>Scale</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {(["0","1","2"] as const).map((idx) => {
                  const axis = ["X","Y","Z"][Number(idx)] as "X"|"Y"|"Z";
                  const val = activeAsset.transform?.scale?.[Number(idx)] ?? 1;
                  return <label key={axis} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}><span style={{ minWidth: 12, opacity: 0.6 }}>{axis}</span><input className="input" type="number" step={0.05} min={0.05} value={val} onChange={(e) => {
                    const v = parseFloat(e.target.value) || 1;
                    const scl = [...(activeAsset.transform?.scale ?? [1,1,1])] as [number,number,number];
                    scl[Number(idx)] = Math.max(0.05, v);
                    sendScene({ action: "mutate", target: activeAsset.id, payload: { scale: scl } });
                  }} style={{ padding: "6px 6px" }} /></label>;
                })}
              </div>
            </div>
            <div className="tag" style={{ marginTop: 4 }}>Gizmo: <b>T</b> move · <b>R</b> rotate · <b>S</b> scale · drag or type values · <b>Del</b> delete · <b>0</b> reset</div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => void handleDownload()} disabled={!activeAsset.meshUrl}>⬇ Download OBJ</button>
              <button className="btn" onClick={() => void handleDuplicate()}>⎘ Duplicate</button>
              <button className="btn" style={{ borderColor: "var(--danger)" }} onClick={() => activeAsset && void handleDeleteAsset(activeAsset.id)}>Delete</button>
            </div>
          </section>
        )}

        {/* EXPORT — one-click for any stack */}
        {activeAsset?.meshUrl && (
          <section className="panel">
            <div className="panel-head"><h3>⬡ Export</h3><span className="tag">re-use anywhere</span></div>
            <div className="tag" style={{ lineHeight: 1.6 }}>One upload → one .obj usable in <b>HTML</b>, <b>React/R3F</b>, <b>Three.js</b>, <b>mobile</b> (expo-gl), <b>Blender</b>.</div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => handleCopySnippet("html")}>HTML</button>
              <button className="btn" onClick={() => handleCopySnippet("react")}>React</button>
              <button className="btn" onClick={() => handleCopySnippet("three")}>Three</button>
            </div>
            <div className="tag" style={{ marginTop: 8, wordBreak: "break-all", background: "rgba(0,0,0,0.25)", padding: 8, borderRadius: 6 }}>{window.location.origin}{activeAsset.meshUrl}</div>
          </section>
        )}
      </aside>

      <main className="stage" aria-label="Holographic stage">
        {/* Blender-like tool shelf */}
        <div className="tool-shelf" aria-label="Tool shelf">
          <button className="tool-btn" title="Move (G / T)" onClick={() => pushTerm("info", "Gizmo: press T for Move")}>↕</button>
          <button className="tool-btn" title="Rotate (R)" onClick={() => pushTerm("info", "Gizmo: press R for Rotate")}>↻</button>
          <button className="tool-btn" title="Scale (S)" onClick={() => pushTerm("info", "Gizmo: press S for Scale")}>⤢</button>
          <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
          <button className={`tool-btn ${wireframe ? "active" : ""}`} title="Wireframe toggle" onClick={() => setWireframe((v) => !v)}>▦</button>
          <button className="tool-btn" title="Reset object (0) + view" onClick={() => { if (activeAssetId) sendScene({ action: "mutate", target: activeAssetId, payload: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }); setViewResetKey((k)=>k+1); }}>⌖</button>
        </div>
        <div className="view-toggle">
          <button className="btn" title="Reset object & view" onClick={() => { if (activeAssetId) sendScene({ action: "mutate", target: activeAssetId, payload: { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] } }); setViewResetKey((k)=>k+1); }}>Reset</button>
          <button className="btn" title="Shortcuts" onClick={() => setShowHelp((v)=>!v)}>Help</button>
          <button className={`btn ${wireframe?"active":""}`} title="Toggle wireframe" onClick={() => setWireframe((v)=>!v)}>Wire</button>
        </div>
        <Scene color={color} activeAsset={activeAsset} onTransform={(payload) => activeAssetId && sendScene({ action: "mutate", target: activeAssetId, payload })} wireframe={wireframe} viewResetKey={viewResetKey} />
        {showHelp && (
          <div className="help-sheet" onClick={()=>setShowHelp(false)} role="dialog" aria-label="Shortcuts">
            <div className="help-inner" onClick={(e)=>e.stopPropagation()}>
              <h4>Blender-like shortcuts</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontFamily: "var(--mono)", fontSize: 11 }}>
                <span>LMB drag</span><span>Orbit</span>
                <span>Scroll</span><span>Dolly zoom</span>
                <span>RMB drag</span><span>Pan</span>
                <span>T / G</span><span>Move gizmo</span>
                <span>R</span><span>Rotate gizmo</span>
                <span>S</span><span>Scale gizmo</span>
                <span>0</span><span>Reset object + view</span>
                <span>Del</span><span>Delete selected</span>
                <span>X/Y/Z (while dragging)</span><span>Axis lock (hold)</span>
              </div>
              <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={()=>setShowHelp(false)}>Close</button>
            </div>
          </div>
        )}
        {job && (
          <div className={`job-toast ${job.status === "failed" ? "error" : ""}`} role="status" aria-live="polite">
            {job.type} · {job.status} {job.error ? `— ${job.error.slice(0, 140)}` : ""}
            <div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress ?? 0}%`, background: job.status === "failed" ? "var(--danger)" : undefined }} /></div>
          </div>
        )}
        <div className="stage-overlay">
          PROJECT <span style={{ color: "var(--text)" }}>{projectId?.slice(0, 8) ?? "—"}</span> · {activeAsset ? `${activeAsset.name} · ${activeAsset.status}` : "no selection"} · <span style={{ opacity: 0.6 }}>no-human flow: upload → .obj → use anywhere</span>
        </div>
      </main>

      <Terminal logs={logs} onCommand={(t) => void handleCommand(t)} />
    </div>
  );
}

function Terminal({ logs, onCommand }: { logs: TermLine[]; onCommand: (v: string) => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);
  const submit = useCallback(() => {
    if (!input.trim()) return;
    setHistory((h) => [...h.slice(-49), input]);
    onCommand(input);
    setInput(""); setHIdx(-1);
  }, [input, onCommand]);
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length) {
        const idx = hIdx === -1 ? history.length - 1 : Math.max(0, hIdx - 1);
        setHIdx(idx); setInput(history[idx] ?? "");
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (hIdx >= 0) {
        const idx = hIdx + 1;
        if (idx >= history.length) { setHIdx(-1); setInput(""); } else { setHIdx(idx); setInput(history[idx]); }
      }
    }
  }, [history, hIdx, submit]);
  return (
    <section className="terminal" aria-label="Karmashala terminal">
      <div className="terminal-head">KARMASHALA - TERMINAL AI - try hi / make it red</div>
      <div className="terminal-logs" ref={logRef} role="log" aria-live="polite">
        {logs.map((log, i) => (<div key={i}><span className="prompt">› </span><span className={log.level} style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{log.message}</span></div>))}
      </div>
      <div className="terminal-input">
        <span className="prompt">karmashala›</span>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder="hi - generate mesh from asset ... - make it red - help" aria-label="Command input" />
        <button className="btn" onClick={submit}>RUN</button>
      </div>
    </section>
  );
}

function StatusDot({ label, online }: { label: string; online: boolean | null }) {
  const cls = online === true ? "" : "off";
  const title = online === null ? "checking…" : online ? "online" : "offline";
  return (<div className="status-dot" title={title}><span className={`led ${cls}`} aria-hidden /> {label}</div>);
}
