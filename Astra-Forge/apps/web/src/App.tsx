import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useSocket } from "./useSocket";
import { Scene } from "./scene/Scene";
import type { ModelAsset, Project } from "@astraforge/shared";

interface TermLine {
  timestamp: string;
  level: string;
  message: string;
}

export function App() {
  const { job, logs: socketLogs, subscribeToJob } = useSocket();
  const [ollamaUp, setOllamaUp] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [assets, setAssets] = useState<ModelAsset[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [color, setColor] = useState("#00e5ff");
  const [uploading, setUploading] = useState(false);
  const [termLines, setTermLines] = useState<TermLine[]>([
    { timestamp: new Date().toISOString(), level: "info", message: "Karmashala online. Type a command." },
  ]);

  useEffect(() => {
    api
      .listProjects()
      .then((list) => {
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
      })
      .catch((error) => pushTerm("error", error.message));
  }, []);

  useEffect(() => {
    fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) })
      .then(() => setOllamaUp(true))
      .catch(() => setOllamaUp(false));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api
      .listAssets()
      .then((all) => setAssets(all.filter((a) => a.projectId === projectId)))
      .catch((error) => pushTerm("error", error.message));
  }, [projectId]);

  const activeAsset = useMemo(
    () => assets.find((a) => a.id === activeAssetId) ?? null,
    [assets, activeAssetId]
  );

  function pushTerm(level: string, message: string) {
    setTermLines((prev) => [
      ...prev.slice(-199),
      { timestamp: new Date().toISOString(), level, message },
    ]);
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await api.createProject(name);
      setProjects((prev) => [...prev, project]);
      setProjectId(project.id);
      setNewProjectName("");
      pushTerm("info", `created project "${name}" (${project.id.slice(0, 8)})`);
    } catch (error) {
      pushTerm("error", (error as Error).message);
    }
  }

  async function handleUpload(file: File | null) {
    if (!file || !projectId) return;
    setUploading(true);
    try {
      const asset = await api.uploadImage(projectId, file);
      setAssets((prev) => [...prev, asset]);
      setActiveAssetId(asset.id);
      pushTerm("info", `imported "${file.name}" as asset ${asset.id.slice(0, 8)}`);
    } catch (error) {
      pushTerm("error", (error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleRunVision(assetId: string) {
    try {
      const job = await api.runVision(assetId);
      pushTerm("info", `vision job ${job.id.slice(0, 8)} queued`);
      if (job?.id) subscribeToJob(job.id);
    } catch (error) {
      pushTerm("error", (error as Error).message);
    }
  }

  async function handleCommand(text: string) {
    if (!text.trim()) return;
    pushTerm("info", `» ${text}`);
    try {
      const result = await api.karmashala(text);
      pushTerm(result.ok ? "info" : "error", result.output);
    } catch (error) {
      pushTerm("error", (error as Error).message);
    }
  }

  const logs = useMemo(
    () => [...socketLogs.map((l) => ({ ...l } as TermLine)), ...termLines],
    [socketLogs, termLines]
  );

  return (
    <div className="app">
      <header className="hud">
        <div className="brand">
          ASTRA<span className="forge">FORGE</span>
        </div>
        <div className="status-dots">
          <StatusDot label="SERVER" online={true} />
          <StatusDot label="OLLAMA" online={ollamaUp} />
          <StatusDot label="SOCKET" online={true} />
        </div>
      </header>

      <aside className="sidebar">
        <div>
          <h3>Projects</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              placeholder="new project…"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            />
            <button className="btn" onClick={handleCreateProject} disabled={!newProjectName.trim()}>
              +
            </button>
          </div>
          <ul className="list" style={{ marginTop: 10 }}>
            {projects.map((p) => (
              <li
                key={p.id}
                className={p.id === projectId ? "selected" : ""}
                onClick={() => setProjectId(p.id)}
              >
                {p.name}
                <div className="tag">{p.id.slice(0, 8)}</div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Assets</h3>
          <label className="btn file-upload" style={{ display: "block", textAlign: "center" }}>
            {uploading ? "uploading…" : "＋ import 2D image"}
            <input
              type="file"
              accept="image/*"
              disabled={!projectId}
              onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
            />
          </label>
          <ul className="list" style={{ marginTop: 10 }}>
            {assets.map((a) => (
              <li
                key={a.id}
                className={a.id === activeAssetId ? "selected" : ""}
                onClick={() => setActiveAssetId(a.id)}
              >
                <span className="tag">{a.source} · </span>
                {a.name}
                <div>
                  <span className={`status ${a.status}`}>{a.status}</span>
                </div>
              </li>
            ))}
          </ul>
          {activeAsset && activeAsset.status === "uploaded" && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => handleRunVision(activeAsset.id)}>
                Generate 3D mesh
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="stage">
        <div className="view-toggle">
          <button className={`btn ${!exploded ? "active" : ""}`} onClick={() => setExploded(false)}>
            Assemble
          </button>
          <button className={`btn ${exploded ? "active" : ""}`} onClick={() => setExploded(true)}>
            Explode
          </button>
        </div>

        <label style={{ position: "absolute", left: 16, top: 18, zIndex: 10, fontFamily: "var(--mono)", fontSize: 11, color: "var(--hologram-dim)" }}>
          hologram color{" "}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ verticalAlign: "middle", width: 28, height: 22, border: "none", background: "none" }}
          />
        </label>

        <Scene exploded={exploded} color={color} activeAsset={activeAsset} />

        {job && (
          <div className="job-toast">
            {job.type} · {job.status}
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${job.progress ?? 0}%` }} />
            </div>
          </div>
        )}

        <div className="stage-overlay">
          PROJECT <span style={{ color: "var(--text)" }}>{projectId ?? "—"}</span> · UNITS mm · TARGET 3D PRINTER
        </div>
      </main>

      <Terminal logs={logs} onCommand={(text) => void handleCommand(text)} />
    </div>
  );
}

function Terminal({
  logs,
  onCommand,
}: {
  logs: TermLine[];
  onCommand: (v: string) => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  return (
    <section className="terminal">
      <div className="terminal-head">KARMASHALA › TERMINAL AI</div>
      <div className="terminal-logs" ref={logRef}>
        {logs.map((log, i) => (
          <div key={i}>
            <span className="prompt">› </span>
            <span className={log.level}>{log.message}</span>
          </div>
        ))}
      </div>
      <div className="terminal-input">
        <span className="prompt">karmashala›</span>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onCommand(input);
              setInput("");
            }
          }}
          placeholder="e.g. list projects — generate mesh from asset abc12345…"
        />
        <button
          className="btn"
          onClick={() => {
            onCommand(input);
            setInput("");
          }}
        >
          RUN
        </button>
      </div>
    </section>
  );
}

function StatusDot({ label, online }: { label: string; online: boolean }) {
  return (
    <div className="status-dot">
      <span className={`led ${online ? "" : "off"}`} />
      {label}
    </div>
  );
}