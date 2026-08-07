import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { isMemoryMode } from "./db.js";

export interface Storable {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight repository that persists to MongoDB when available and
 * transparently falls back to an in-memory Map otherwise (dev friendly).
 */
export class Store<T extends Storable> {
  private memory = new Map<string, T>();
  private readonly model: mongoose.Model<Record<string, unknown>> | null;

  constructor(name: string, schema: mongoose.Schema) {
    this.model = isMemoryMode() ? null : (mongoose.models[name] ?? mongoose.model(name, schema));
  }

  async list(): Promise<T[]> {
    if (this.model) {
      const docs = await this.model.find({}).lean().exec();
      return docs.map((d) => {
        const { _id, ...rest } = d as Record<string, unknown>;
        return { ...rest, id: String(_id) } as unknown as T;
      });
    }
    return [...this.memory.values()];
  }

  async get(id: string): Promise<T | null> {
    if (this.model) {
const doc = await this.model.findOne({ _id: id }).lean().exec();
      if (!doc) return null;
      const { _id, ...rest } = doc as Record<string, unknown>;
      return { ...rest, id: String(_id) } as unknown as T;
    }
    return this.memory.get(id) ?? null;
  }

  async create(doc: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
    const now = new Date().toISOString();
    const entity = { ...doc, id: randomUUID(), createdAt: now, updatedAt: now } as unknown as T;
    if (this.model) {
      const saved = await this.model.create(entity).then((d) => d.toObject());
      const { _id, ...rest } = saved as Record<string, unknown>;
      return { ...rest, id: String(_id) } as unknown as T;
    }
    this.memory.set((entity as unknown as { id: string }).id, entity);
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    if (this.model) {
      await this.model.updateOne({ _id: id }, { $set: patch as Record<string, unknown> }).exec();
    } else {
      this.memory.set(id, updated);
    }
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    if (this.model) {
      const result = await this.model.deleteOne({ _id: id }).exec();
      return result.deletedCount > 0;
    }
    return this.memory.delete(id);
  }
}