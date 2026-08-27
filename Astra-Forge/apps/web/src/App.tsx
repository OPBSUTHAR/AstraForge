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

export function App() {
  const { job, logs: socketLogs, assetUpdates, sceneCommands, subscribeToJob, connected, sendScene } = useSocket();
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [color, setColor] = useState("#00e5ff");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [termLines, setTermLines] = useState<TermLine[]>([{ timestamp: new Date().toISOString(), level: "info", message: "Karmashala online. Type 'help'." }]);

  const pushTerm = useCallback((level: TermLine["level"], message: string) => {
    setTermLines((prev) => [...prev.slice(-199), { timestamp: new Date().toISOString(), level, message }]);
  }, []);

  // Persist project in URL
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

  // Load projects
  useEffect(() => {
    api
      .listProjects()
      .then((list) => {
        setProjects(list);
        if (!projectId && list.length > 0) setProjectId(list[0].id);
      })
      .catch((e) => pushTerm("error", e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Health checks via backend proxy
  useEffect(() => {
    let alive = true;
    api.health().then(() => alive && setServerUp(true)).catch(() => alive && setServerUp(false));
    api.karmashalaHealth().then((h) => alive && setOllamaUp(h.ollama === "online")).catch(() => alive && setOllamaUp(false));
    const t = setInterval(() => {
      api.health().then(() => alive && setServerUp(true)).catch(() => alive && setServerUp(false));
    }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Load assets for selected project (server-filtered)
  const refreshAssets = useCallback(async () => {
    if (!projectId) { setAssets([]); return; }
    try {
      const list = await api.listAssets(projectId);
      setAssets(list);
      // auto-select latest ready
      if (!activeAssetId && list.length) {
        const ready = list.find((a) => a.status === "ready") ?? list[list.length - 1];
        setActiveAssetId(ready.id);
      }
    } catch (e) { pushTerm("error", (e as Error).message); }
  }, [projectId, activeAssetId, pushTerm]);

  useEffect(() => { void refreshAssets(); }, [refreshAssets]);

  // React to socket asset updates
  useEffect(() => {
    if (assetUpdates.length === 0) return;
    const latest = assetUpdates[assetUpdates.length - 1];
    if ((latest as unknown as { deleted?: boolean }).deleted) {
      setAssets((p) => p.filter((a) => a.id !== latest.id));
      return;
    }
    setAssets((prev) => {
      const idx = prev.findIndex((a) => a.id === latest.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = latest; return next; }
      // only add if belongs to current project
      if (latest.projectId === projectId) return [...prev, latest];
      return prev;
    });
    if (latest.status === "ready") setActiveAssetId(latest.id);
    pushTerm("info", `asset update: ${latest.name} → ${latest.status}`);
  }, [assetUpdates, projectId, pushTerm]);

  // Scene commands from socket
  useEffect(() => {
    if (sceneCommands.length === 0) return;
    const cmd = sceneCommands[sceneCommands.length - 1] as { action: string; text?: string };
    if (cmd.action === "spawn") pushTerm("info", `◈ spawn: ${cmd.text ?? ""}`);
    if (cmd.action === "mutate") pushTerm("info", `◈ mutate: ${cmd.text ?? ""}`);
    if (cmd.action === "redesign") {
      try {
        const parsed = JSON.parse(cmd.text ?? "{}");
        if (parsed.value && typeof parsed.value === "string" && parsed.value.startsWith("#")) setColor(parsed.value);
      } catch { /* ignore */ }
    }
  }, [sceneCommands, pushTerm]);

  const activeAsset = useMemo(() => assets.find((a) => a.id === activeAssetId) ?? null, [assets, activeAssetId]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const p = await api.createProject(name);
      setProjects((prev) => [...prev, p]);
      setProjectId(p.id);
      setNewProjectName("");
      pushTerm("info", `created "${name}" (${p.id.slice(0, 8)})`);
    } catch (e) { pushTerm("error", (e as Error).message); }
  }

  async function handleUpload(file: File | null) {
    if (!file || uploading) return;
    if (file.size > 15 * 1024 * 1024) { pushTerm("error", "file too large (>15MB)"); return; }
    setUploading(true);
    try {
      let pid = projectId;
      if (!pid) {
        const p = await api.createProject("Untitled project");
        setProjects((prev) => [...prev, p]);
        pid = p.id; setProjectId(p.id);
        pushTerm("info", `no project — created "${p.name}"`);
      }
      const asset = await api.uploadImage(pid, file);
      setAssets((prev) => [...prev, asset]);
      setActiveAssetId(asset.id);
      pushTerm("info", `imported "${file.name}" → ${asset.id.slice(0, 8)}`);
    } catch (e) { pushTerm("error", `import failed: ${(e as Error).message}`); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRunVision(id: string) {
    try {
      const j = await api.runVision(id);
      pushTerm("info", `vision job ${j.id.slice(0, 8)} queued`);
      subscribeToJob(j.id);
    } catch (e) { pushTerm("error", (e as Error).message); }
  }

  async function handleCommand(text: string) {
    if (!text.trim()) return;
    pushTerm("info", `» ${text}`);
    try {
      const r = await api.karmashala(text);
      pushTerm(r.ok ? "info" : "warn", r.output);
      // live spawn/mutate already handled via socket, but also apply color scale locally
      if (r.action === "scene:mutate") {
        const lower = text.toLowerCase();
        // naive colour parse
        const col = lower.match(/#[0-9a-f]{6}|red|blue|cyan|green|orange|purple|pink|yellow/);
        if (col) {
          const map: Record<string, string> = { red: "#ff3b30", blue: "#0a84ff", cyan: "#00e5ff", green: "#30d158", orange: "#ff9f0a", purple: "#af52de", pink: "#ff2d55", yellow: "#ffd60a" };
          setColor(map[col[0]] ?? col[0]);
        }
        // mutate via socket to persist
        if (activeAssetId) {
          if (lower.includes("scale up")) sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [1.4, 1.4, 1.4] } });
          if (lower.includes("scale down")) sendScene({ action: "mutate", target: activeAssetId, payload: { scale: [0.8, 0.8, 0.8] } });
          if (lower.includes("reset")) sendScene({ action: "mutate", target: activeAssetId, payload: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
        }
      }
    } catch (e) { pushTerm("error", (e as Error).message); }
  }

  async function handleDeleteAsset(id: string) {
    try {
      await api.deleteAsset(id);
      setAssets((p) => p.filter((a) => a.id !== id));
      if (activeAssetId === id) setActiveAssetId(null);
      pushTerm("info", `deleted ${id.slice(0, 8)}`);
    } catch (e) { pushTerm("error", (e as Error).message); }
  }

  const logs = useMemo(() => [...socketLogs.map((l) => ({ ...l } as TermLine)), ...termLines].slice(-200), [socketLogs, termLines]);

  return (
    <div className="app">
      <header className="hud">
        <div className="brand">ASTRA<span className="forge">FORGE</span></div>
        <div className="status-dots">
          <StatusDot label="SERVER" online={serverUp} />
          <StatusDot label="OLLAMA" online={ollamaUp} />
          <StatusDot label="SOCKET" online={connected} />
        </div>
        <div style={{ marginLeft: 12, fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>v0.2 · reborn</div>
      </header>

      <aside className="sidebar" aria-label="Projects and assets">
        <div>
          <h3>Projects</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" aria-label="New project name" placeholder="new project…" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void handleCreateProject()} />
            <button className="btn" aria-label="Create project" onClick={() => void handleCreateProject()} disabled={!newProjectName.trim()}>＋</button>
          </div>
          <ul className="list" style={{ marginTop: 10 }}>
            {projects.map((p) => (
              <li key={p.id} className={p.id === projectId ? "selected" : ""} onClick={() => setProjectId(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setProjectId(p.id)}>
                {p.name} <div className="tag">{p.id.slice(0, 8)}</div>
              </li>
            ))}
            {projects.length === 0 && <li style={{ opacity: 0.6, cursor: "default" }}>no projects — create one</li>}
          </ul>
        </div>

        <div>
          <h3>Assets {projectId ? `· ${assets.length}` : ""}</h3>
          <label className="btn file-upload" style={{ display: "block", textAlign: "center" }} aria-label="Import image">
            {uploading ? "uploading…" : "＋ import 2D image"}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tiff,.tif,.eps,.ps,.ai,application/postscript,application/eps" disabled={uploading} onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)} />
          </label>
          <div className="tag" style={{ marginTop: 6, opacity: 0.7 }}>Supports JPG, PNG, WEBP, GIF, BMP, TIFF, EPS/PS</div>
          <ul className="list" style={{ marginTop: 10 }}>
            {assets.map((a) => (
              <li key={a.id} className={a.id === activeAssetId ? "selected" : ""} onClick={() => setActiveAssetId(a.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {a.previewDataUrl && <img src={a.previewDataUrl} alt="" className="thumb" loading="lazy" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="tag">{a.source} · </span>{a.name}
                    <div><span className={`status ${a.status}`}>{a.status}</span>{a.stats ? <span className="tag"> · {a.stats.triangles} tris</span> : null}</div>
                  </div>
                  <button className="btn" style={{ padding: "4px 6px", fontSize: 10 }} onClick={(e) => { e.stopPropagation(); void handleDeleteAsset(a.id); }} aria-label={`Delete ${a.name}`}>✕</button>
                </div>
              </li>
            ))}
            {assets.length === 0 && <li style={{ opacity: 0.6, cursor: "default" }}>no assets — import an image</li>}
          </ul>
          {activeAsset && activeAsset.status === "uploaded" && (
            <button className="btn" style={{ marginTop: 12, width: "100%" }} onClick={() => void handleRunVision(activeAsset.id)}>Generate 3D mesh</button>
          )}
          {activeAsset?.meshUrl && <div className="tag" style={{ marginTop: 8, wordBreak: "break-all" }}>mesh: {activeAsset.meshUrl}</div>}
        </div>
      </aside>

      <main className="stage" aria-label="Holographic stage">
        <div className="view-toggle">
          <button className={`btn ${!exploded ? "active" : ""}`} onClick={() => setExploded(false)} aria-pressed={!exploded}>Assemble</button>
          <button className={`btn ${exploded ? "active" : ""}`} onClick={() => setExploded(true)} aria-pressed={exploded}>Explode</button>
        </div>
        <label style={{ position: "absolute", left: 16, top: 18, zIndex: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--hologram-dim)" }}>
          hologram color{" "}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ verticalAlign: "middle", width: 28, height: 22, border: "none", background: "none" }} aria-label="Hologram color" />
        </label>
        <Scene exploded={exploded} color={color} activeAsset={activeAsset} />
        {job && (
          <div className="job-toast" role="status" aria-live="polite">
            {job.type} · {job.status}
            <div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress ?? 0}%` }} /></div>
          </div>
        )}
        <div className="stage-overlay">
          PROJECT <span style={{ color: "var(--text)" }}>{projectId?.slice(0, 8) ?? "—"}</span> · UNITS mm · TARGET 3D PRINTER · {activeAsset ? `${activeAsset.name}` : "no selection"}
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

  return (
    <section className="terminal" aria-label="Karmashala terminal">
      <div className="terminal-head">KARMASHALA › TERMINAL AI</div>
      <div className="terminal-logs" ref={logRef} role="log" aria-live="polite">
        {logs.map((log, i) => (
          <div key={i}><span className="prompt">› </span><span className={log.level} style={{ wordBreak: "break-word" }}>{log.message}</span></div>
        ))}
      </div>
      <div className="terminal-input">
        <span className="prompt">karmashala›</span>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "ArrowUp") { e.preventDefault(); if (history.length) { const idx = hIdx === -1 ? history.length - 1 : Math.max(0, hIdx - 1); setHIdx(idx); setInput(history[idx] ?? ""); } }
            if (e.key === "ArrowDown") { e.preventDefault(); if (hIdx >= 0) { const idx = hIdx + 1; if (idx >= history.length) { setHIdx(-1); setInput(""); } else { setHIdx(idx); setInput(history[idx]); } } }
          }}
          placeholder="e.g. list projects — generate mesh from asset … — make it red — add a cube"
          aria-label="Command input"
        />
        <button className="btn" onClick={submit}>RUN</button>
      </div>
    </section>
  );
}

function StatusDot({ label, online }: { label: string; online: boolean | null }) {
  const cls = online === true ? "" : online === false ? "off" : "off";
  const title = online === null ? "checking…" : online ? "online" : "offline";
  return (
    <div className="status-dot" title={title}>
      <span className={`led ${cls}`} aria-hidden /> {label}
    </div>
  );
}
