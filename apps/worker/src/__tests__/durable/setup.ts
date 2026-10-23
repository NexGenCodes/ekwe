import { env } from "cloudflare:test";
import { vi, beforeAll, afterEach, afterAll } from "vitest";
import { network } from "@/__tests__/msw/network";
import { resetWsKeyPenalties } from "@/utils/stream";
import {
  defaultMockDbExecute,
  type MockExecuteQuery,
} from "@/__tests__/helpers/mock-db";

// The Durable Objects use the D1-backed `getDb`. Replace it with an in-memory,
// Drizzle-shaped stand-in so the DO tests do not depend on D1 state and get
// deterministic query results while still exercising the same call sites.
const mockDb = {
  execute: (query: MockExecuteQuery) => defaultMockDbExecute(query),
  select(this: unknown) {
    return this;
  },
  from(this: unknown) {
    return this;
  },
  where(this: unknown) {
    return this;
  },
  insert(this: unknown) {
    return this;
  },
  values(this: unknown) {
    return this;
  },
  onConflictDoUpdate(this: unknown) {
    return this;
  },
  update(this: unknown) {
    return this;
  },
  set(this: unknown) {
    return this;
  },
};

vi.mock("@/db", () => ({
  getDb: () => mockDb,
}));

beforeAll(async () => {
  network.enable();
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS user_daily_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, translate_count INTEGER NOT NULL DEFAULT 0, transcribe_count INTEGER NOT NULL DEFAULT 0, transcribe_ms INTEGER NOT NULL DEFAULT 0, speech_chars INTEGER NOT NULL DEFAULT 0, stream_count INTEGER NOT NULL DEFAULT 0, stream_ms INTEGER NOT NULL DEFAULT 0, ai_credits REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, day))",
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS user_monthly_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, translate_count INTEGER NOT NULL DEFAULT 0, transcribe_count INTEGER NOT NULL DEFAULT 0, transcribe_ms INTEGER NOT NULL DEFAULT 0, speech_chars INTEGER NOT NULL DEFAULT 0, stream_count INTEGER NOT NULL DEFAULT 0, stream_ms INTEGER NOT NULL DEFAULT 0, ai_credits REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, month))",
  );
});

afterEach(() => {
  network.resetHandlers();
  resetWsKeyPenalties();
});

afterAll(() => {
  network.disable();
});
