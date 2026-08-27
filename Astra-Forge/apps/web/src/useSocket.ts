import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { PipelineJob, ServerToClientEvents, ClientToServerEvents, ModelAsset, SceneCommand } from "@astraforge/shared";

export interface KarmashalaLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export function useSocket() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [jobs, setJobs] = useState<Record<string, PipelineJob>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [logs, setLogs] = useState<KarmashalaLog[]>([]);
  const [assetUpdates, setAssetUpdates] = useState<ModelAsset[]>([]);
  const [sceneCommands, setSceneCommands] = useState<SceneCommand[]>([]);

  useEffect(() => {
    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));
    s.on("job:update", (update) => {
      setJobs((prev) => ({ ...prev, [(update as PipelineJob).id]: update as PipelineJob }));
      setActiveJobId((update as PipelineJob).id);
    });
    s.on("karmashala:log", (entry) => {
      setLogs((prev) => [...prev.slice(-199), entry as KarmashalaLog]);
    });
    s.on("asset:update", (asset) => {
      setAssetUpdates((prev) => [...prev.slice(-50), asset as ModelAsset]);
    });
    s.on("scene:command", (cmd) => {
      setSceneCommands((prev) => [...prev.slice(-50), cmd as unknown as SceneCommand]);
    });
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  const subscribeToJob = useCallback((jobId: string) => {
    socketRef.current?.emit("job:subscribe", jobId);
    setActiveJobId(jobId);
  }, []);

  const sendCommand = useCallback((text: string) => socketRef.current?.emit("karmashala:command", text), []);
  const sendScene = useCallback((cmd: SceneCommand) => socketRef.current?.emit("scene:command", cmd as never), []);

  const activeJob = activeJobId ? jobs[activeJobId] ?? null : null;

  return { socket: socketRef.current, connected, job: activeJob, jobs, logs, assetUpdates, sceneCommands, subscribeToJob, sendCommand, sendScene, setJobs };
}
