/**
 * Wraps a route handler with the Cloudflare Cache API.
 * Preserves the handler's Cache-Control header if already set.
 */
export async function withCache(
  request: Request,
  ctx: ExecutionContext,
  handler: () => Response | Promise<Response>,
  ttlSeconds: number,
): Promise<Response> {
  // Cloudflare Workers provides `caches.default` but types may not include it.
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const response = await cache.match(request);
  if (response) return response;

  const res = await handler();
  if (res.status !== 200) return res;

  // Preserve handler's Cache-Control if set; otherwise add a default.
  const headers = new Headers(res.headers);
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      `public, max-age=${ttlSeconds}, stale-while-revalidate=${Math.min(ttlSeconds, 300)}`,
    );
  }

  const cacheRes = new Response(res.body, { ...res, headers });

  // Cache in the background.
  ctx.waitUntil(cache.put(request, cacheRes.clone()));

  return cacheRes;
}
