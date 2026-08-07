import mongoose from "mongoose";
import { config } from "./config.js";

/** True when MongoDB is unreachable; the store falls back to in-memory maps. */
export let memoryMode = true;

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
    memoryMode = false;
    console.log(`[db] connected to ${config.mongoUri}`);
  } catch (error) {
    memoryMode = true;
    console.warn(
      `[db] MongoDB unreachable (${(error as Error).message}). Running in-memory; ` +
        "start Mongo (see .env.example) to persist projects."
    );
  }
}

export function isMemoryMode(): boolean {
  return memoryMode;
}