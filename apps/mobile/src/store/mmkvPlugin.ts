import type {
  Change,
  ObservablePersistLocal,
  PersistMetadata,
  PersistOptionsLocal,
} from "@legendapp/state";
import { internal, setAtPath } from "@legendapp/state";
import { configureObservablePersistence } from "@legendapp/state/persist";

import { initializeMMKV, mmkv } from "@/services/mmkv";
import logger from "@/utils/logger";

const { safeParse, safeStringify } = internal;

const MetadataSuffix = "__m";

export class ObservablePersistMMKV implements ObservablePersistLocal {
  private data: Record<string, unknown> = {};

  // Async preload — legend-state awaits this before calling getTable. It blocks
  // until the encrypted MMKV is ready so persisted values are loaded from the
  // real store (never from the plaintext in-memory fallback).
  loadTable(table: string, _config: PersistOptionsLocal): Promise<void> {
    if (this.data[table] !== undefined) {
      return Promise.resolve();
    }
    return (async (): Promise<void> => {
      try {
        await initializeMMKV();
        const value = mmkv.getString(table);
        this.data[table] = value ? safeParse(value) : undefined;
      } catch {
        logger.error("[legend-state] MMKV failed to load", table);
      }
    })();
  }

  // Gets
  getTable<T = unknown>(
    table: string,
    _config: PersistOptionsLocal,
    init: object,
  ): T {
    const value = this.data[table];
    return (value !== undefined ? value : init) as T;
  }

  getMetadata(table: string, config: PersistOptionsLocal): PersistMetadata {
    return this.getTable(table + MetadataSuffix, config, {});
  }

  // Sets
  set(table: string, changes: Change[], _config: PersistOptionsLocal): void {
    if (!this.data[table]) {
      this.data[table] = {};
    }
    for (let i = 0; i < changes.length; i++) {
      const { path, valueAtPath, pathTypes } = changes[i];
      this.data[table] = setAtPath(
        this.data[table] as object,
        path,
        pathTypes,
        valueAtPath,
      );
    }
    this.save(table);
  }

  async setMetadata(
    table: string,
    metadata: PersistMetadata,
    _config: PersistOptionsLocal,
  ): Promise<void> {
    this.data[table + MetadataSuffix] = metadata;
    this.save(table + MetadataSuffix);
  }

  deleteTable(table: string, _config: PersistOptionsLocal): void {
    delete this.data[table];
    mmkv.remove(table);
  }

  deleteMetadata(table: string, config: PersistOptionsLocal): void {
    this.deleteTable(table + MetadataSuffix, config);
  }

  // Private
  private save(table: string): void {
    const v = this.data[table];
    if (v !== undefined) {
      try {
        mmkv.set(table, safeStringify(v));
      } catch (err) {
        logger.error(err);
      }
    } else {
      mmkv.remove(table);
    }
  }
}

/**
 * Configure Legend State to use our custom MMKV persistence plugin globally.
 */
configureObservablePersistence({
  pluginLocal: ObservablePersistMMKV,
});
