import mongoose from "mongoose";
import { config } from "./config.js";

/** True when MongoDB is unreachable; the store falls back to in-memory maps. */
let memoryMode = true;
let connectPromise: Promise<void> | null = null;

export async function connectDatabase(): Promise<void> {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 4000,
        maxPoolSize: 10,
        retryWrites: true,
      });
      memoryMode = false;
      console.log(`[db] connected to ${config.mongoUri}`);

      mongoose.connection.on("error", (err) => {
        console.error("[db] connection error:", err.message);
      });
      mongoose.connection.on("disconnected", () => {
        console.warn("[db] disconnected — falling back to memory until reconnect");
        memoryMode = true;
      });
      mongoose.connection.on("reconnected", () => {
        memoryMode = false;
        console.log("[db] reconnected");
      });
    } catch (error) {
      memoryMode = true;
      console.warn(
        `[db] MongoDB unreachable (${(error as Error).message}). Running in-memory; ` +
          "start Mongo (see .env.example) to persist projects.",
      );
    }
  })();
  return connectPromise;
}

export function isMemoryMode(): boolean {
  // Also check mongoose readyState: 1 = connected
  if (mongoose.connection.readyState === 1) return false;
  return memoryMode;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  memoryMode = true;
  connectPromise = null;
}
