import http from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { SceneCommandSchema, TransformSchema, type SceneCommand } from "@astraforge/shared";
import { assets } from "./data.js";
import { corsOptions } from "./config.js";
import type { ServerToClientEvents, ClientToServerEvents } from "@astraforge/shared";

export let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

// Lightweight per-socket rate limit for scene spam
const lastSceneAt = new WeakMap<Socket, number>();

export function initSocketHttp(server: http.Server): void {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: corsOptions() as never,
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);

    socket.on("job:subscribe", (jobId) => {
      if (typeof jobId !== "string" || jobId.length < 8) return;
      void socket.join(`job:${jobId}`);
    });

    socket.on("karmashala:command", (text) => {
      if (typeof text !== "string" || text.length > 2000) {
        socket.emit("karmashala:log", { timestamp: new Date().toISOString(), level: "error", message: "command too long" });
        return;
      }
      void handleKarmashalaCommand(socket, text);
    });

    socket.on("scene:command", (cmd) => {
      const now = Date.now();
      const prev = lastSceneAt.get(socket) ?? 0;
      if (now - prev < 80) return; //  ~12Hz max
      lastSceneAt.set(socket, now);
      void handleSceneCommand(socket, cmd);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected ${socket.id} (${reason})`);
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

export function emitKarmashalaLog(level: "info" | "warn" | "error", message: string): void {
  io?.emit("karmashala:log", { timestamp: new Date().toISOString(), level, message });
}

export function emitSceneCommand(cmd: SceneCommand): void {
  io?.emit("scene:command", cmd as never);
}

async function handleKarmashalaCommand(socket: Socket, text: string): Promise<void> {
  try {
    const { karmashala } = await import("./karmashala/index.js");
    const result = await karmashala.run(text);
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: result.ok ? "info" : "warn",
      message: result.output,
    });

    if (result.action === "scene:mutate" || result.action === "scene:spawn" || result.action === "scene:redesign") {
      const action = result.action === "scene:mutate" ? "mutate" : result.action === "scene:spawn" ? "spawn" : "redesign";
      // broadcast to everyone including sender for hologram sync
      io?.emit("scene:command", { action, text });
    }
  } catch (error) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: (error as Error).message,
    });
  }
}

async function handleSceneCommand(socket: Socket, raw: unknown): Promise<void> {
  const parsed = SceneCommandSchema.safeParse(raw);
  if (!parsed.success) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: `invalid scene command: ${parsed.error.issues[0]?.message}`,
    });
    return;
  }
  const cmd = parsed.data;
  try {
    if (cmd.target && (cmd.action === "mutate" || cmd.action === "select")) {
      const existing = await assets.get(cmd.target);
      if (!existing) return;
      if (cmd.action === "mutate" && cmd.payload) {
        const p = cmd.payload as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        // Validate position/rotation/scale tuples strictly
        for (const key of ["position", "rotation", "scale"] as const) {
          if (Array.isArray(p[key])) {
            const arr = p[key] as unknown[];
            if (arr.length === 3 && arr.every((n) => typeof n === "number" && Number.isFinite(n))) {
              const tuple = arr as [number, number, number];
              // scale must be positive
              if (key === "scale" && tuple.some((n) => n <= 0 || n > 100)) continue;
              if (key !== "scale" && tuple.some((n) => Math.abs(n) > 10000)) continue;
              (patch as Record<string, unknown>)[key] = tuple;
            }
          }
        }
        if (Object.keys(patch).length) {
          const current = existing.transform ?? { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
          const next = { ...current, ...patch } as typeof current;
          // Extra zod guard
          const t = TransformSchema.safeParse(next);
          if (t.success) {
            const updated = await assets.update(cmd.target, { transform: t.data } as unknown as Record<string, unknown>);
            if (updated) emitAssetUpdate(updated as unknown as Record<string, unknown>);
          }
        }
      }
    }
    // broadcast to all *except* sender to avoid echo jitter, sender already has optimistic update
    socket.broadcast.emit("scene:command", cmd as never);
    // also echo to sender for consistency
    socket.emit("scene:command", cmd as never);
  } catch (error) {
    socket.emit("karmashala:log", {
      timestamp: new Date().toISOString(),
      level: "error",
      message: `scene command failed: ${(error as Error).message}`,
    });
  }
}
