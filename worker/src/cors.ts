import { Env } from "./types";

export function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") || request.headers.get("origin");
  const allowedOrigins =
    env.ALLOWED_ORIGINS?.split(",").map((o: string) => o.trim()).filter(Boolean) || [];

  const isDev =
    env.APP_ENV !== "production" &&
    !!origin &&
    (origin.startsWith("exp://") ||
      origin.includes(".expo.dev") ||
      origin.includes(".expo.io") ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1"));

  const isExactMatch = !!origin && allowedOrigins.includes(origin);
  const isAllowed = isExactMatch || isDev;

  return {
    ...(isAllowed && { "Access-Control-Allow-Origin": origin }),
    ...(isAllowed && { "Access-Control-Allow-Credentials": "true" }),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export function addCorsHeaders(
  response: Response,
  corsHeaders: Record<string, string>,
): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}
