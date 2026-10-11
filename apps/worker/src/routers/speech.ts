import { Hono } from "hono";
import type { AppEnv } from "@/app";
import { zValidator } from "@hono/zod-validator";
import {
  WORKER_ERROR_CODES,
  translateRequestSchema,
  synthesizeRequestSchema,
} from "@ekwe/shared";
import { authMiddleware, preflightMiddleware } from "@/middleware";
import { handleTranscribe } from "@/routes/transcribe";
import { handleTranslate } from "@/routes/translate";
import {
  synthesizeFromAudio,
  synthesizeFromText,
  createGateCharge,
} from "@/routes/synthesize";
import { speechAudioHandler } from "@/routes/speech-audio";
import { SYNTHESIZE_TOTAL_MS } from "@/core/budgets";
import {
  guardWebSocketUpgrade,
  guardStreamingAllowed,
  guardAutoDetect,
  guardLanguageCode,
} from "@/core/guards";

export const speechRouter = new Hono<AppEnv>();

speechRouter.get("/speech/:key", (c) =>
  speechAudioHandler({
    request: c.req.raw,
    env: c.env,
    ctx: c.executionCtx as unknown as ExecutionContext,
    params: c.req.param(),
    timings: c.get("timings"),
  }),
);

speechRouter.post(
  "/transcribe",
  authMiddleware(),
  preflightMiddleware("transcribe"),
  (c) =>
    handleTranscribe(
      c.req.raw,
      c.env,
      c.get("tier"),
      c.get("pipelineTier"),
      c.req.raw.signal,
      c.get("auth")!.userId,
      c.executionCtx as unknown as ExecutionContext,
    ),
);

speechRouter.post(
  "/translate",
  authMiddleware(),
  zValidator("json", translateRequestSchema, (result, c) => {
    if (!result.success) {
      const firstPath = result.error.issues[0]?.path[0];
      if (firstPath === "targetLang") {
        return c.json(
          { error: WORKER_ERROR_CODES.INVALID_TARGET_LANGUAGE },
          400,
        );
      }
      if (firstPath === "sourceLang") {
        return c.json({ error: WORKER_ERROR_CODES.INVALID_LANGUAGE }, 400);
      }
      return c.json({ error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT }, 400);
    }
  }),
  preflightMiddleware("translate"),
  (c) =>
    handleTranslate(
      c.req.valid("json"),
      c.env,
      c.get("tier"),
      c.get("pipelineTier"),
      c.req.raw.signal,
      c.get("auth")!.userId,
      c.executionCtx as unknown as ExecutionContext,
    ),
);

speechRouter.post("/synthesize", authMiddleware(), async (c) => {
  const ct = c.req.header("Content-Type") || "";
  const start = Date.now();
  const remainingMs = () => SYNTHESIZE_TOTAL_MS - (Date.now() - start);
  const gateCharge = createGateCharge();

  if (ct.includes("multipart/form-data")) {
    return synthesizeFromAudio(
      c.req.raw,
      c.env,
      c.get("tier"),
      c.req.raw.signal,
      c.get("auth")!.userId,
      c.get("auth")!.sessionId,
      c.executionCtx as unknown as ExecutionContext,
      remainingMs,
      c.get("timings"),
      gateCharge,
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await c.req.json();
  } catch {
    return c.json({ error: WORKER_ERROR_CODES.INVALID_BODY }, 400);
  }

  const parsed = synthesizeRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return c.json({ error: WORKER_ERROR_CODES.INVALID_BODY }, 400);
  }

  return synthesizeFromText(
    parsed.data,
    c.env,
    c.get("tier"),
    c.req.raw.signal,
    c.get("auth")!.userId,
    c.get("auth")!.sessionId,
    c.executionCtx as unknown as ExecutionContext,
    remainingMs,
    c.get("timings"),
    gateCharge,
  );
});

speechRouter.get("/transcribe/stream", authMiddleware(true), (c) => {
  const request = c.req.raw;
  const env = c.env;
  const auth = c.get("auth")!;
  const tier = c.get("tier");

  const upgradeGuard = guardWebSocketUpgrade(request);
  if (upgradeGuard) return upgradeGuard;

  const streamingGuard = guardStreamingAllowed(tier);
  if (!streamingGuard.allowed) return streamingGuard.response;

  const streamUrl = new URL(request.url);
  const streamLang = streamUrl.searchParams.get("lang") || "en";

  const autoGuard = guardAutoDetect(streamLang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(streamLang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  const doUrl = new URL(request.url);
  doUrl.searchParams.set("tier", tier);
  if (auth.sessionId) doUrl.searchParams.set("sid", auth.sessionId);
  const stub = env.STREAM_DO.getByName(
    auth.userId,
  ) as unknown as DurableObjectStub;
  return stub.fetch(new Request(doUrl.toString(), request));
});
