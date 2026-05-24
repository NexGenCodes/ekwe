import { internal, setAtPath } from '@legendapp/state';
import type {
  Change,
  ObservablePersistLocal,
  PersistMetadata,
  PersistOptionsLocal,
} from '@legendapp/state';

import { Db } from '@/services/db';
import { logger } from '@/utils';

const { safeParse, safeStringify } = internal;
const MetadataSuffix = '__m';

export class ObservablePersistSQLite implements ObservablePersistLocal {
  private data: Record<string, unknown> = {};

  getTable<T = unknown>(
    table: string,
    _config: PersistOptionsLocal,
    init: object,
  ): T {
    if (this.data[table] === undefined) {
      try {
        const raw = Db.getStore(table);
        this.data[table] = raw ? safeParse(raw) : init;
      } catch {
        logger.error('[sqlitePlugin] Failed to parse key:', table);
        this.data[table] = init;
      }
    }
    return this.data[table] as T;
  }

  getMetadata(table: string, config: PersistOptionsLocal): PersistMetadata {
    return this.getTable<PersistMetadata>(table + MetadataSuffix, config, {});
  }

  set(table: string, changes: Change[], _config: PersistOptionsLocal): void {
    if (this.data[table] === undefined) {
      this.data[table] = {};
    }
    for (const { path, pathTypes, valueAtPath } of changes) {
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
    Db.removeStore(table);
  }

  deleteMetadata(table: string, config: PersistOptionsLocal): void {
    this.deleteTable(table + MetadataSuffix, config);
  }

  private save(table: string): void {
    const v = this.data[table];
    if (v !== undefined) {
      try {
        Db.setStore(table, safeStringify(v));
      } catch (err) {
        logger.error('[sqlitePlugin] Failed to save key:', table, err);
      }
    } else {
      Db.removeStore(table);
    }
  }
}
