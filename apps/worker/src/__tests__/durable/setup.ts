import { vi, beforeAll, afterEach, afterAll } from "vitest";
import { network } from "@/__tests__/msw/network";
import { resetWsKeyPenalties } from "@/utils/stream";
import {
  defaultMockDbExecute,
  type MockExecuteQuery,
} from "@/__tests__/helpers/mock-db";

// The Durable Objects reach Supabase through Hyperdrive over the Postgres wire
// protocol. That cannot be intercepted by MSW (there is no HTTP request to
// mock) and there is no local Postgres in the workerd test pool, so the real
// `getDb` would open a TCP socket to 127.0.0.1:54322 and fail with "Network
// connection lost", making the stream preflight gate fail closed. Replace
// `getDb` with an in-memory, Drizzle-shaped stand-in so DO tests exercise the
// same code path with deterministic RPC responses.
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

beforeAll(() => {
  network.enable();
});

afterEach(() => {
  network.resetHandlers();
  resetWsKeyPenalties();
});

afterAll(() => {
  network.disable();
});
