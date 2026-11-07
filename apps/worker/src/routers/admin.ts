import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import {
  registerPushTokenRequestSchema,
  pushNotifyRequestSchema,
  updateManifestSchema,
} from "@ekwe/shared";
import {
  adminAuthMiddleware,
  authMiddleware,
  adminUserMiddleware,
} from "@/middleware";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import { handlePostUpdateManifest, handleUpdateNotify } from "@/routes/admin";
import {
  handleListUsers,
  handleSetPro,
  handleListAudit,
} from "@/routes/adminUsers";
import {
  handleBilling,
  handleUsage,
  handleAdminHealth,
  handleAuditWrite,
} from "@/routes/adminOps";

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

adminRouter.get("/users", adminUserMiddleware, handleListUsers);
adminRouter.post("/users/:id/pro", adminUserMiddleware, handleSetPro);
adminRouter.get("/audit", adminUserMiddleware, handleListAudit);
adminRouter.get("/billing", adminUserMiddleware, handleBilling);
adminRouter.get("/usage", adminUserMiddleware, handleUsage);
adminRouter.get("/health", adminUserMiddleware, handleAdminHealth);
adminRouter.post("/audit", adminUserMiddleware, handleAuditWrite);
