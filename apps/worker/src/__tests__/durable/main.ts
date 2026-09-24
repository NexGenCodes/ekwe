import { StreamDurableObject } from "@/durable/stream-do";
import { ThrottleBucket } from "@/durable/throttle-do";

export { StreamDurableObject, ThrottleBucket };

export default {
  async fetch(): Promise<Response> {
    return new Response("test worker", { status: 200 });
  },
} satisfies ExportedHandler;
