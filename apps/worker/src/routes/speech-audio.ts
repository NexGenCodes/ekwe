import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { error } from "@/core/http";
import { readSpeechCache } from "@/services/speech";
import { verifySpeechUrl } from "@/utils/speech-url";
import type { Env } from "@/core/types";
import type { RequestTimings } from "@/core/timing";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  timings: RequestTimings;
}

type RouteHandler = (rctx: RouteContext) => Response | Promise<Response>;

const CACHE_KEY_RE =
  /^speech:(?:shared|[a-f0-9]{64}):[A-Za-z0-9_-]+:(?:male|female|auto):(?:free|premium):cache:[A-Za-z-]+:[a-f0-9]{64}(?::r\d+)?\.[a-f0-9]{32}$/;

/**
 * Serves previously synthesised audio out of the speech cache.
 *
 * `/synthesize` used to inline the audio as base64, which inflated every
 * response by a third and spent CPU encoding megabytes that the client was
 * about to turn back into bytes anyway. It now hands back a URL to this route
 * and the payload stays a few hundred bytes regardless of clip length.
 */
export const speechAudioHandler: RouteHandler = async ({
  request,
  params,
  env,
  ctx,
}) => {
  const key = params.key ?? "";
  if (!CACHE_KEY_RE.test(key)) {
    return error(WORKER_ERROR_CODES.INVALID_BODY, 400);
  }

  const cacheKey = await verifySpeechUrl(env, key);
  if (!cacheKey) {
    return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  }

  const edgeCache =
    typeof caches !== "undefined" && "default" in caches
      ? (caches as unknown as { default: Cache }).default
      : null;
  if (edgeCache) {
    const edgeHit = await edgeCache.match(request);
    if (edgeHit) return edgeHit;
  }

  const hit = await readSpeechCache(env, cacheKey);
  if (!hit) {
    return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  }

  const response = new Response(hit.audio as BodyInit, {
    headers: {
      "Content-Type": hit.mime,
      "Content-Length": String(hit.audio.byteLength),
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "none",
    },
  });

  if (edgeCache && typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(edgeCache.put(request, response.clone()).catch(() => {}));
  }

  return response;
};

/** Test-only helper: the digest shape the route accepts. */
export const isSpeechCacheKey = (value: string): boolean =>
  CACHE_KEY_RE.test(value);
