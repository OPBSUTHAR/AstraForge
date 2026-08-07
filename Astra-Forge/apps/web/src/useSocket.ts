import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PipelineJob, ServerToClientEvents, ClientToServerEvents } from "@astraforge/shared";

export interface KarmashalaLog {
  timestamp: string;
  level: string;
  message: string;
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [job, setJob] = useState<PipelineJob | null>(null);
  const [logs, setLogs] = useState<KarmashalaLog[]>([]);

  useEffect(() => {
    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io();

    s.on("job:update", (update) => {
      setJob(update);
    });
    s.on("karmashala:log", (entry) => {
      setLogs((prev) => [...prev.slice(-199), entry]);
    });

    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  const subscribeToJob = (jobId: string) => socket?.emit("job:subscribe", jobId);
  const sendCommand = (text: string) => socket?.emit("karmashala:command", text);

  return { socket, job, logs, subscribeToJob, sendCommand, setJob };
}