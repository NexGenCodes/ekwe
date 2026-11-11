import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import {
  registerPushTokenRequestSchema,
  pushNotifyRequestSchema,
  updateManifestSchema,
} from "@ekwe/shared";
import {
  adminReleaseMiddleware,
  authMiddleware,
  adminUserMiddleware,
} from "@/middleware";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import { handlePostUpdateManifest, handleUpdateNotify } from "@/routes/admin";
import {
  handleCancelScheduledDeleteUser,
  handleDeleteUser,
  handleExportAudit,
  handleGetUser,
  handleGetUserDetails,
  handleListAudit,
  handleListUsers,
  handleRevokeUserSessions,
  handleScheduleDeleteUser,
  handleSetPro,
  handleSetUserDisabled,
  handleSetUserRole,
  handleSetUserSuspended,
} from "@/routes/adminUsers";
import {
  handleBilling,
  handleBillingSync,
  handleUsage,
  handleAdminHealth,
  handleAuditWrite,
  handleGetAdminManifest,
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
  adminReleaseMiddleware,
  zValidator("json", pushNotifyRequestSchema),
  (c) => handleUpdateNotify(c.req.valid("json"), c.env, c.get("adminEmail")),
);

adminRouter.post(
  "/update/manifest",
  adminReleaseMiddleware,
  zValidator("json", updateManifestSchema),
  (c) =>
    handlePostUpdateManifest(c.req.valid("json"), c.env, c.get("adminEmail")),
);
adminRouter.get(
  "/update/manifest",
  adminUserMiddleware,
  handleGetAdminManifest,
);

adminRouter.get("/users", adminUserMiddleware, handleListUsers);
adminRouter.get("/users/:id", adminUserMiddleware, handleGetUser);
adminRouter.get(
  "/users/:id/details",
  adminUserMiddleware,
  handleGetUserDetails,
);
adminRouter.post("/users/:id/pro", adminUserMiddleware, handleSetPro);
adminRouter.post("/users/:id/role", adminUserMiddleware, handleSetUserRole);
adminRouter.post(
  "/users/:id/revoke-sessions",
  adminUserMiddleware,
  handleRevokeUserSessions,
);
adminRouter.post(
  "/users/:id/disable",
  adminUserMiddleware,
  handleSetUserDisabled,
);
adminRouter.post(
  "/users/:id/suspend",
  adminUserMiddleware,
  handleSetUserSuspended,
);
adminRouter.post(
  "/users/:id/schedule-delete",
  adminUserMiddleware,
  handleScheduleDeleteUser,
);
adminRouter.post(
  "/users/:id/cancel-delete",
  adminUserMiddleware,
  handleCancelScheduledDeleteUser,
);
adminRouter.post("/users/:id/delete", adminUserMiddleware, handleDeleteUser);
adminRouter.get("/audit/export", adminUserMiddleware, handleExportAudit);
adminRouter.get("/audit", adminUserMiddleware, handleListAudit);
adminRouter.get("/billing", adminUserMiddleware, handleBilling);
adminRouter.post("/billing/sync", adminUserMiddleware, handleBillingSync);
adminRouter.get("/usage", adminUserMiddleware, handleUsage);
adminRouter.get("/health", adminUserMiddleware, handleAdminHealth);
adminRouter.post("/audit", adminUserMiddleware, handleAuditWrite);
