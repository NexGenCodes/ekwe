import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);

type SqlValue = null | number | bigint | string | Uint8Array;

function normalize(value: unknown): SqlValue {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value as SqlValue;
}

class BoundStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): BoundStatement {
    return new BoundStatement(this.db, this.sql, params.map(normalize));
  }

  execSync(): {
    changes: number;
    last_row_id: number;
    results: unknown[];
  } {
    const statement = this.db.prepare(this.sql);
    if (/\breturning\b/i.test(this.sql)) {
      const results = statement.all(...this.params) as unknown[];
      return { changes: results.length, last_row_id: 0, results };
    }
    const result = statement.run(...this.params);
    return {
      changes: Number(result.changes),
      last_row_id: Number(result.lastInsertRowid),
      results: [],
    };
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T | null;
    return row as T;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows };
  }

  async run(): Promise<{
    success: true;
    meta: { changes: number; last_row_id: number };
  }> {
    return { success: true, meta: this.execSync() };
  }
}

export class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): BoundStatement {
    return new BoundStatement(this.db, sql);
  }

  async batch(statements: BoundStatement[]): Promise<unknown[]> {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        const executed = statement.execSync();
        return {
          success: true,
          meta: {
            changes: executed.changes,
            last_row_id: executed.last_row_id,
          },
          results: executed.results,
        };
      });
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export interface TestDatabase {
  sqlite: DatabaseSync;
  d1: D1Database;
}

export function createTestDatabase(): TestDatabase {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  return { sqlite, d1: new SqliteD1(sqlite) as unknown as D1Database };
}
