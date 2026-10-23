import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "@/app";
import { MAX_HISTORY_BATCH_BYTES, WORKER_ERROR_CODES } from "@ekwe/shared";
import { authMiddleware } from "@/middleware";
import { handlePull, handlePush } from "@/routes/sync";

export const syncRouter = new Hono<AppEnv>();

syncRouter.use(
  "*",
  bodyLimit({
    maxSize: MAX_HISTORY_BATCH_BYTES,
    onError: (c) =>
      c.json({ error: WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE }, 413),
  }),
);

syncRouter.post("/pull", authMiddleware(), handlePull);
syncRouter.post("/push", authMiddleware(), handlePush);
