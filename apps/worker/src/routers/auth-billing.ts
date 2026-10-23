import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import {
  checkoutRequestSchema,
  verifyTransactionRequestSchema,
} from "@ekwe/shared";
import { authMiddleware } from "@/middleware";
import {
  handleBillingFlags,
  handleCheckout,
  handleVerifyTransaction,
} from "@/routes/billing";
import { handleUsage } from "@/routes/usage";

export const billingRouter = new Hono<AppEnv>();
export const usageRouter = new Hono<AppEnv>();

billingRouter.post(
  "/checkout",
  authMiddleware(),
  zValidator("json", checkoutRequestSchema),
  (c) => handleCheckout(c.req.valid("json"), c.env, c.get("auth")!),
);

billingRouter.post(
  "/verify-transaction",
  authMiddleware(),
  zValidator("json", verifyTransactionRequestSchema),
  (c) => handleVerifyTransaction(c.req.valid("json"), c.env, c.get("auth")!),
);

billingRouter.get("/flags", (c) => handleBillingFlags(c.req.raw, c.env));

usageRouter.get("/", authMiddleware(), (c) =>
  handleUsage(c.env, c.get("auth")!.userId, c.get("auth")!.tier),
);
