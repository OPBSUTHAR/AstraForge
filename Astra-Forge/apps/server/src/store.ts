import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { isMemoryMode } from "./db.js";

export interface Storable {
  id: string;
  createdAt: string;
  updatedAt: string;
}

function toStorable<T>(doc: Record<string, unknown>): T {
  const { _id, __v, ...rest } = doc;
  // Prefer stored UUID `id` field; fall back to _id only if no id present
  if (rest.id && typeof rest.id === "string") {
    const { _id: _ignored, __v: _v2, ...clean } = doc as Record<string, unknown>;
    return clean as unknown as T;
  }
  return { ...rest, id: String(_id) } as unknown as T;
}

/**
 * Repository that persists to MongoDB when connected and falls back to an
 * in-memory Map otherwise. Model resolution is lazy so DB can connect after
 * Store instantiation.
 */
export class Store<T extends Storable> {
  private memory = new Map<string, T>();
  private readonly name: string;
  private readonly schema: mongoose.Schema;

  constructor(name: string, schema: mongoose.Schema) {
    this.name = name;
    this.schema = schema;
  }

  private get model(): mongoose.Model<Record<string, unknown>> | null {
    if (isMemoryMode()) return null;
    try {
      return (mongoose.models[this.name] as mongoose.Model<Record<string, unknown>>) ?? mongoose.model(this.name, this.schema);
    } catch {
      return null;
    }
  }

  async list(opts: { limit?: number; offset?: number; filter?: Record<string, unknown> } = {}): Promise<T[]> {
    const { limit = 100, offset = 0, filter = {} } = opts;
    const m = this.model;
    if (m) {
      const docs = await m.find(filter).sort({ createdAt: -1 }).skip(offset).limit(Math.min(limit, 100)).lean().exec();
      return docs.map((d) => toStorable<T>(d as Record<string, unknown>));
    }
    let items = [...this.memory.values()];
    // naive filter for memory mode
    if (filter && Object.keys(filter).length) {
      items = items.filter((it) => Object.entries(filter).every(([k, v]) => (it as Record<string, unknown>)[k] === v));
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.slice(offset, offset + limit);
  }

  async get(id: string): Promise<T | null> {
    const m = this.model;
    if (m) {
      // id is UUID string stored as `id` field, not ObjectId _id
      // Try both: first by custom `id`, then by _id if valid ObjectId
      let doc = await m.findOne({ id }).lean().exec();
      if (!doc && mongoose.Types.ObjectId.isValid(id)) {
        doc = await m.findOne({ _id: id }).lean().exec();
      }
      if (!doc) return null;
      return toStorable<T>(doc as Record<string, unknown>);
    }
    return this.memory.get(id) ?? null;
  }

  async create(doc: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T> {
    const now = new Date().toISOString();
    const entity = { ...doc, id: randomUUID(), createdAt: now, updatedAt: now } as unknown as T;
    const m = this.model;
    if (m) {
      const saved = await m.create(entity as Record<string, unknown>);
      const obj = (saved as unknown as { toObject: () => Record<string, unknown> }).toObject();
      return toStorable<T>(obj);
    }
    this.memory.set((entity as unknown as { id: string }).id, entity);
    return entity;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updatedAt = new Date().toISOString();
    const cleanPatch = { ...patch, id: undefined } as Record<string, unknown>;
    delete cleanPatch.id;
    const m = this.model;
    if (m) {
      const res = await m.findOneAndUpdate(
        { id },
        { $set: { ...cleanPatch, updatedAt } },
        { new: true, lean: true },
      ).exec();
      if (res) return toStorable<T>(res as Record<string, unknown>);
      // fallback to _id search
      const res2 = await m.findOneAndUpdate(
        { _id: id } as Record<string, unknown>,
        { $set: { ...cleanPatch, updatedAt } },
        { new: true, lean: true },
      ).exec();
      if (res2) return toStorable<T>(res2 as Record<string, unknown>);
      return null;
    }
    const updated = { ...existing, ...cleanPatch, id, updatedAt } as unknown as T;
    this.memory.set(id, updated);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const m = this.model;
    if (m) {
      let result = await m.deleteOne({ id }).exec();
      if (result.deletedCount === 0 && mongoose.Types.ObjectId.isValid(id)) {
        result = await m.deleteOne({ _id: id } as Record<string, unknown>).exec();
      }
      if (result.deletedCount > 0) return true;
      // also try memory
      return this.memory.delete(id);
    }
    return this.memory.delete(id);
  }

  async count(filter: Record<string, unknown> = {}): Promise<number> {
    const m = this.model;
    if (m) return m.countDocuments(filter).exec();
    if (!Object.keys(filter).length) return this.memory.size;
    return [...this.memory.values()].filter((it) => Object.entries(filter).every(([k, v]) => (it as Record<string, unknown>)[k] === v)).length;
  }
}
