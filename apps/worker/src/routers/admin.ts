import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import {
  registerPushTokenRequestSchema,
  pushNotifyRequestSchema,
  updateManifestSchema,
} from "@ekwe/shared";
import { adminAuthMiddleware, authMiddleware } from "@/middleware";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import { handlePostUpdateManifest, handleUpdateNotify } from "@/routes/admin";

export const adminRouter = new Hono<AppEnv>();
export const deviceRouter = new Hono<AppEnv>();

deviceRouter.post(
  "/token",
  authMiddleware(),
  zValidator("json", registerPushTokenRequestSchema),
  (c) => handleRegisterDeviceToken(c.req.valid("json"), c.env, c.get("auth")!),
);

adminRouter.post(
  "/update/notify",
  adminAuthMiddleware,
  zValidator("json", pushNotifyRequestSchema),
  (c) => handleUpdateNotify(c.req.valid("json"), c.env),
);

adminRouter.post(
  "/update/manifest",
  adminAuthMiddleware,
  zValidator("json", updateManifestSchema),
  (c) => handlePostUpdateManifest(c.req.valid("json"), c.env),
);
