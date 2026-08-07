import http from "node:http";
import { Server, type Socket } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@astraforge/shared";

export let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function initSocketHttp(server: http.Server): void {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    socket.on("job:subscribe", (jobId) => {
      void socket.join(`job:${jobId}`);
    });
    socket.on("karmashala:command", (text) => {
      void handleKarmashalaCommand(socket, text);
    });
  });
}

/** Emit a job update to any subscribed client. Safe no-op when socket server absent. */
export function emitJobUpdate(jobId: string, payload: Record<string, unknown>): void {
  io?.to(`job:${jobId}`).emit("job:update", payload as never);
}

export function emitKarmashalaLog(level: string, message: string): void {
  io?.emit("karmashala:log", { timestamp: new Date().toISOString(), level, message });
}

async function handleKarmashalaCommand(socket: Socket, text: string): Promise<void> {
  try {
    const { karmashala } = await import("./karmashala/index.js");
    const result = await karmashala.run(text);
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "info",
      message: JSON.stringify(result),
    });
  } catch (error) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: (error as Error).message,
    });
  }
}