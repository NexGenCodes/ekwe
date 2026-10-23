import type { Context } from "hono";
import type { z } from "zod";
import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { error } from "@/core/http";

export async function readJson<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return error(WORKER_ERROR_CODES.INVALID_BODY, 400);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return error(
      field === "email"
        ? WORKER_ERROR_CODES.INVALID_EMAIL
        : WORKER_ERROR_CODES.INVALID_BODY,
      400,
    );
  }

  return parsed.data;
}
