import http from "node:http";
import { Server, type Socket } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@astraforge/shared";
import { assets } from "../data.js";

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
    socket.on("scene:command", (cmd) => {
      void handleSceneCommand(socket, cmd);
    });
  });
}

/** Emit a job update to any subscribed client. Safe no-op when socket server absent. */
export function emitJobUpdate(jobId: string, payload: Record<string, unknown>): void {
  io?.to(`job:${jobId}`).emit("job:update", payload as never);
}

export function emitAssetUpdate(payload: Record<string, unknown>): void {
  io?.emit("asset:update", payload as never);
}

export function emitKarmashalaLog(level: string, message: string): void {
  io?.emit("karmashala:log", { timestamp: new Date().toISOString(), level, message });
}

export function emitSceneCommand(cmd: ServerToClientEvents["scene:command"]): void {
  io?.emit("scene:command", cmd);
}

async function handleKarmashalaCommand(socket: Socket, text: string): Promise<void> {
  try {
    const { karmashala } = await import("../karmashala/index.js");
    const result = await karmashala.run(text);
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "info",
      message: JSON.stringify(result),
    });

    // Forward intents that mutate the live hologram to every viewer.
    if (result.action === "scene:mutate" || result.action === "scene:spawn" || result.action === "scene:redesign") {
      const action = result.action === "scene:mutate"
        ? "mutate"
        : result.action === "scene:spawn"
          ? "spawn"
          : "redesign";
      emitSceneCommand({ action, text });
    }
  } catch (error) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: (error as Error).message,
    });
  }
}

async function handleSceneCommand(
  socket: Socket,
  cmd: ClientToServerEvents["scene:command"],
): Promise<void> {
  // Apply server-side persistence (transforms) and rebroadcast to everyone.
  try {
    if (cmd.target && (cmd.action === "mutate" || cmd.action === "select")) {
      const existing = await assets.get(cmd.target);
      if (!existing) return;
      const next = existing;
      if (cmd.action === "mutate" && cmd.payload && typeof cmd.payload === "object") {
        const transform = { ...(next.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }) };
        const p = cmd.payload as Record<string, unknown>;
        if (Array.isArray(p.position)) transform.position = p.position as [number, number, number];
        if (Array.isArray(p.rotation)) transform.rotation = p.rotation as [number, number, number];
        if (Array.isArray(p.scale)) transform.scale = p.scale as [number, number, number];
        const updated = await assets.update(cmd.target, { transform });
        if (updated) emitAssetUpdate(updated as unknown as Record<string, unknown>);
      }
    }
    io?.emit("scene:command", cmd);
  } catch (error) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: `scene command failed: ${(error as Error).message}`,
    });
  }
}
