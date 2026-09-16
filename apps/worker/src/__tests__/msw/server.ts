import { setupServer } from "msw/node";
import { defaultHandlers } from "./handlers";

/**
 * Node (unit project) MSW server. Lifecycle lives in tests/setup.ts; tests
 * register per-test handlers via `server.use(...)`.
 */
export const server = setupServer(...defaultHandlers);
