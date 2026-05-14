import { internal, setAtPath } from '@legendapp/state';
import type {
  Change,
  ObservablePersistLocal,
  PersistMetadata,
  PersistOptionsLocal,
} from '@legendapp/state';

import { mmkv } from './mmkvStorage';

import { logger } from '@/utils';

const { safeParse, safeStringify } = internal;
const MetadataSuffix = '__m';

/**
 * Custom Legend-State persistence plugin wrapping our pre-initialised MMKV
 * instance from mmkvStorage.ts.
 *
 * Why custom:  @legendapp/state/persist-plugins/mmkv uses `new MMKV()` from
 * the old react-native-mmkv v3 API.  Our project uses v4 (Nitro Modules)
 * which exports `createMMKV()` — the MMKV class constructor does not exist,
 * causing "Cannot read property 'prototype' of undefined" at boot.
 *
 * v4 API used here: getString / set / remove (NOT delete).
 */
export class ObservablePersistMMKVCustom implements ObservablePersistLocal {
  private data: Record<string, unknown> = {};

  // ─── Reads ────────────────────────────────────────────────────────────────

  getTable<T = unknown>(
    table: string,
    _config: PersistOptionsLocal,
    init: object,
  ): T {
    if (this.data[table] === undefined) {
      try {
        const raw = mmkv.getString(table);
        this.data[table] = raw ? safeParse(raw) : init;
      } catch {
        logger.error('[ekwe-store] MMKV failed to parse key:', table);
        this.data[table] = init;
      }
    }
    return this.data[table] as T;
  }

  getMetadata(table: string, config: PersistOptionsLocal): PersistMetadata {
    return this.getTable<PersistMetadata>(table + MetadataSuffix, config, {});
  }

  // ─── Writes ───────────────────────────────────────────────────────────────

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

  // ─── Deletes ──────────────────────────────────────────────────────────────

  deleteTable(table: string, _config: PersistOptionsLocal): void {
    delete this.data[table];
    mmkv.remove(table); // v4 API: remove, not delete
  }

  deleteMetadata(table: string, config: PersistOptionsLocal): void {
    this.deleteTable(table + MetadataSuffix, config);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private save(table: string): void {
    const v = this.data[table];
    if (v !== undefined) {
      try {
        mmkv.set(table, safeStringify(v));
      } catch (err) {
        logger.error('[ekwe-store] MMKV failed to save key:', table, err);
      }
    } else {
      mmkv.remove(table); // v4 API
    }
  }
}
