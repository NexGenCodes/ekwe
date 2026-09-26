import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { error } from "@/core/http";
import type { RouteHandler } from "@/core/pipeline";
import { readSpeechCache } from "@/services/speech";

/**
 * Cache keys are built from hashed inputs, so this route is addressed by
 * content rather than by anything a client could enumerate. It is deliberately
 * unauthenticated and ungated: the bytes are already paid for, and an
 * `<audio src>` fetch cannot carry a bearer token.
 *
 * The key is a colon-delimited composite — see `buildSpeechCacheKey` — so this
 * mirrors its shape rather than assuming a bare digest. Pinning every segment
 * keeps a crafted path from reaching the bucket with an arbitrary name.
 */
const CACHE_KEY_RE =
  /^speech:(?:shared|[a-f0-9]{64}):[A-Za-z0-9_-]+:(?:male|female|auto):(?:free|premium):cache:[A-Za-z-]+:[a-f0-9]{64}$/;

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

  const hit = await readSpeechCache(env, key);
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
