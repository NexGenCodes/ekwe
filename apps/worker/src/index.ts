import { createWorker } from "./worker";
import { instrumentDurableObject, instrumentWorker } from "./sentry";
import { StreamDurableObject as StreamDurableObjectBase } from "./durable/stream-do";
import { ThrottleBucket as ThrottleBucketBase } from "./durable/throttle-do";

export const StreamDurableObject = instrumentDurableObject(
  StreamDurableObjectBase,
);
export const ThrottleBucket = instrumentDurableObject(ThrottleBucketBase);

export default instrumentWorker(createWorker());
