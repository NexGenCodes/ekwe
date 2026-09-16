// Test entry for `wrangler.tests.toml`. Re-exports the Durable Object so the
// vitest-pool-workers runtime can resolve its class, without pulling in the
// full production worker (auth, opus decoder, KV, AI, ...).
import { StreamDurableObject } from "../../durable/stream-do";
import { ThrottleBucket } from "../../durable/throttle-do";

export { StreamDurableObject, ThrottleBucket };

export default {
  async fetch(): Promise<Response> {
    return new Response("test worker", { status: 200 });
  },
} satisfies ExportedHandler;
