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
  /^speech:(?:shared|[a-f0-9]{64}):[A-Za-z0-9_-]+:(?:male|female|auto):(?:free|premium):cache:[A-Za-z-]+:[a-f0-9]{64}\.[a-f0-9]{32}$/;

/**
 * Serves previously synthesised audio out of the speech cache.
 *
 * `/synthesize` used to inline the audio as base64, which inflated every
 * response by a third and spent CPU encoding megabytes that the client was
 * about to turn back into bytes anyway. It now hands back a URL to this route
 * and the payload stays a few hundred bytes regardless of clip length.
 */
export const speechAudioHandler: RouteHandler = async ({ params, env }) => {
  const key = params.key ?? "";
  if (!CACHE_KEY_RE.test(key)) {
    return error(WORKER_ERROR_CODES.INVALID_BODY, 400);
  }

  const cacheKey = await verifySpeechUrl(env, key);
  if (!cacheKey) {
    return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  }

  const hit = await readSpeechCache(env, cacheKey);
  if (!hit) {
    // Either the write has not landed yet, or the entry aged out. The client
    // treats a miss here as a cache miss and falls back to the inline payload.
    return error(WORKER_ERROR_CODES.NOT_FOUND, 404);
  }

  return new Response(hit.audio as BodyInit, {
    headers: {
      "Content-Type": hit.mime,
      "Content-Length": String(hit.audio.byteLength),
      // The key is a digest of the inputs, so this body can never change for a
      // given URL. Let the client hold it rather than re-fetching on every play.
      "Cache-Control": "private, max-age=86400",
      "Accept-Ranges": "none",
    },
  });
};

/** Test-only helper: the digest shape the route accepts. */
export const isSpeechCacheKey = (value: string): boolean =>
  CACHE_KEY_RE.test(value);
