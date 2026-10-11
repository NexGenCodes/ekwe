import { logger } from "@/core/logger";

export async function withCache(
  request: Request,
  ctx: ExecutionContext,
  handler: () => Response | Promise<Response>,
  ttlSeconds: number,
): Promise<Response> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const response = await cache.match(request);
  if (response) return response;

  const res = await handler();
  if (res.status !== 200) return res;

  const headers = new Headers(res.headers);
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      `public, max-age=${ttlSeconds}, stale-while-revalidate=${Math.min(ttlSeconds, 300)}`,
    );
  }

  const cacheRes = new Response(res.body, { ...res, headers });

  ctx.waitUntil(
    cache.put(request, cacheRes.clone()).catch((err) => {
      logger.warn("[cache] write failed", {
        url: request.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  );

  return cacheRes;
}
