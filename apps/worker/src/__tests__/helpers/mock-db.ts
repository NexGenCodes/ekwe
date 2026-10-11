import type { SQL } from "drizzle-orm";

/**
 * What `getDb().execute()` is handed in production: either a raw string or a
 * Drizzle `sql` template result.
 *
 * Kept free of any Vitest / Node-only import so it can be linked into both the
 * Node unit suite and the workerd worker bundle (see `durable/setup.ts`).
 */
export type MockExecuteQuery = string | (SQL & { sql?: unknown });

/**
 * `getDb().execute()` resolves to the row list itself under the postgres-js
 * driver — every call site reads `result.length` / `result[0]`, never a
 * `rows` envelope.
 */
export type MockRows = unknown[];

/**
 * Flattens an execute query to text so tests can assert on a fragment
 * (`"check_preflight"`) rather than on a whole query object. Drizzle exposes no
 * stable "render to string" accessor, so this falls back to the JSON form,
 * which still carries the literal chunks.
 */
export function executeQueryToSql(query: MockExecuteQuery): string {
  if (typeof query === "string") return query;
  if (typeof query.sql === "string") return query.sql;
  return JSON.stringify(query) || "";
}

/**
 * Bound-parameter chunks of a recorded `execute` call, so a test can assert on
 * the arguments the worker passed to an RPC instead of on rendered SQL.
 */
export function executeQueryChunks(query: MockExecuteQuery): unknown[] {
  return typeof query === "string" ? [] : query.queryChunks;
}

/**
 * Same result shape for every `execute` call site, so tests that only need the
 * happy path (e.g. the Durable Object suites) do not have to know each RPC.
 */
export const defaultMockDbExecute = async (
  query: MockExecuteQuery,
): Promise<MockRows> => {
  const sqlStr = executeQueryToSql(query);

  if (sqlStr.includes("check_session_active")) {
    return [{ active: true }];
  }
  if (sqlStr.includes("check_preflight")) {
    return [{ preflight: { allowed: true, tier_active: "FREE" } }];
  }
  if (sqlStr.includes("consume_usage")) {
    return [{ count: 1 }];
  }
  if (sqlStr.includes("get_daily_usage")) {
    return [{ day: "2026-08-13", translate: 2, transcribe: 0 }];
  }
  return [];
};
