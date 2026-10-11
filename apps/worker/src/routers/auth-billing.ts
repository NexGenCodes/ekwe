import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import { bodyLimit } from "hono/body-limit";
import {
  WORKER_ERROR_CODES,
  otpRequestSchema,
  checkoutRequestSchema,
  verifyTransactionRequestSchema,
} from "@ekwe/shared";
import { authMiddleware } from "@/middleware";
import { handleSendOtp } from "@/routes/otp";
import {
  handleCheckout,
  handleVerifyTransaction,
  handleBillingFlags,
} from "@/routes/billing";
import { handleUsage } from "@/routes/usage";

export const authRouter = new Hono<AppEnv>();
export const billingRouter = new Hono<AppEnv>();

authRouter.post(
  "/otp",
  bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) => c.json({ error: "PAYLOAD_TOO_LARGE" }, 413),
  }),
  zValidator("json", otpRequestSchema, (result, c) => {
    if (!result.success) {
      const firstPath = result.error.issues[0]?.path[0];
      if (firstPath === "email") {
        return c.json({ error: WORKER_ERROR_CODES.INVALID_EMAIL }, 400);
      }
      return c.json({ error: WORKER_ERROR_CODES.INVALID_BODY }, 400);
    }
  }),
  (c) => handleSendOtp(c.req.valid("json"), c.req.raw, c.env),
);

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

export const usageRouter = new Hono<AppEnv>();

usageRouter.get("/", authMiddleware(), (c) =>
  handleUsage(c.env, c.get("auth")!.userId, c.get("auth")!.tier),
);
