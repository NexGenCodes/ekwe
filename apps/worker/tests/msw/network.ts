import { setupNetwork } from "@msw/cloudflare";

/**
 * Workerd (workers pool) MSW network. Lifecycle lives in tests/workers/setup.ts;
 * the streaming tests register `ws.link(...)` handlers via `network.use(...)`.
 */
export const network = setupNetwork();
