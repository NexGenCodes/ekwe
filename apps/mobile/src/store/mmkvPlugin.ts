import type { Change } from "@legendapp/state";
import { internal, setAtPath } from "@legendapp/state";
import type {
  ObservablePersistPlugin,
  PersistMetadata,
  PersistOptions,
} from "@legendapp/state/sync";
import { configureObservableSync } from "@legendapp/state/sync";

import { initializeMMKV, mmkv } from "@/services/mmkv";
import logger from "@/utils/logger";

const { safeParse, safeStringify } = internal as unknown as {
  safeParse: (value: string) => unknown;
  safeStringify: (value: unknown) => string;
};

const MetadataSuffix = "__m";

type TableTransform = (
  data: Record<string, unknown>,
) => Record<string, unknown>;

const tableTransforms = new Map<string, TableTransform>();

/**
 * Register a migration for a persisted table.
 *
 * It runs inside `loadTable`, which makes the plugin the only reader and writer
 * of the stored layout. A migration that writes the same MMKV key from outside
 * this class races `loadTable`: whichever loses has its write replaced by the
 * next `save()`, so the migration is silently lost and never retried.
 */
export function registerTableTransform(
  table: string,
  transform: TableTransform,
): void {
  tableTransforms.set(table, transform);
}

export class ObservablePersistMMKV implements ObservablePersistPlugin {
  private data: Record<string, unknown> = {};

  loadTable(table: string, _config: PersistOptions): Promise<void> | void {
    if (this.data[table] !== undefined) {
      return;
    }
    return (async (): Promise<void> => {
      try {
        await initializeMMKV();
        const value = mmkv.getString(table);
        if (value) {
          const parsed = safeParse(value) as Record<string, unknown> | null;
          const transform = tableTransforms.get(table);
          const migrated = parsed && transform ? transform(parsed) : parsed;
          this.data[table] = migrated;
          if (migrated && transform) {
            mmkv.set(table, safeStringify(migrated));
          }
        }
      } catch {
        logger.error("[legend-state] MMKV failed to load", table);
      }
    })();
  }

  getTable<T = unknown>(
    table: string,
    init: object,
    _config: PersistOptions,
  ): T {
    const value = this.data[table];
    return (value !== undefined ? value : init) as T;
  }

  getMetadata(table: string, config: PersistOptions): PersistMetadata {
    return this.getTable(table + MetadataSuffix, {}, config) as PersistMetadata;
  }

  set(table: string, changes: Change[], _config: PersistOptions): void {
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
    _config: PersistOptions,
  ): Promise<void> {
    this.data[table + MetadataSuffix] = metadata;
    this.save(table + MetadataSuffix);
  }

  deleteTable(table: string, _config: PersistOptions): void {
    delete this.data[table];
    mmkv.remove(table);
  }

  deleteMetadata(table: string, config: PersistOptions): void {
    this.deleteTable(table + MetadataSuffix, config);
  }

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

export const mmkvPlugin = new ObservablePersistMMKV();

configureObservableSync({
  persist: { plugin: mmkvPlugin },
});
