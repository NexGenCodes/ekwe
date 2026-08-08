import { Env } from "./types";

function isDevOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  // Expo Go client (exp://<host>:<port>)
  if (url.protocol === "exp:") return true;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return true;
  }
  // Hostname-suffix match with a domain boundary — `evil.expo.dev.attacker.com`
  // must NOT match.
  return (
    hostname === "expo.dev" ||
    hostname.endsWith(".expo.dev") ||
    hostname === "expo.io" ||
    hostname.endsWith(".expo.io")
  );
}

export function getCorsHeaders(
  request: Request,
  env: Env,
): Record<string, string> {
  const origin = request.headers.get("Origin") || request.headers.get("origin");
  const allowedOrigins =
    env.ALLOWED_ORIGINS?.split(",")
      .map((o: string) => o.trim())
      .filter(Boolean) || [];

  const isDev = env.APP_ENV !== "production" && !!origin && isDevOrigin(origin);

  const isExactMatch = !!origin && allowedOrigins.includes(origin);
  const isAllowed = isExactMatch || isDev;

  return {
    ...(isAllowed && { "Access-Control-Allow-Origin": origin }),
    ...(isAllowed && { "Access-Control-Allow-Credentials": "true" }),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
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
