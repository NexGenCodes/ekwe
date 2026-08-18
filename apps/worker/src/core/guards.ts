import { LANGUAGES, WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "./logger";
import { error } from "./http";
import { getLimits, type Tier } from "./limits";

/**
 * ─── Ekwe Worker Request Guards ─────────────────────────────────
 *
 * Every route handler imports from here instead of hardcoding values.
 *
 * If a malicious user tampers with the frontend (e.g. flipping isPro
 * in MMKV), these limits still apply because the Worker derives the
 * tier from the cryptographically signed Supabase JWT — not from
 * any client-supplied flag.
 *
 * ── Enforcement Layers ──
 *   1. Rate Limiter      → Cloudflare binding (worker.ts)
 *   2. Preflight Check   → Atomic cooldown via Supabase RPC (worker.ts)
 *   3. Payload Guards     → This file (called by transcribe/translate)
 */

// ─── Valid Language Codes (allowlist) ─────────────────────────────
// Derived from the shared LANGUAGES constant. Any code not in this
// set is rejected before it reaches an LLM provider.

const VALID_LANG_CODES = new Set(["auto", ...LANGUAGES.map((l) => l.code)]);

// ─── Guard Results ───────────────────────────────────────────────

interface GuardPass {
  allowed: true;
}
interface GuardFail {
  allowed: false;
  response: Response;
}
type GuardResult = GuardPass | GuardFail;

/** Framing/metadata margin for multipart upload pre-guards (256KB). */
export const MULTIPART_OVERHEAD = 256 * 1024;

/**
 * Standard 429 "slow down" response for the TOO_MANY_REQUESTS wire code.
 * Used by the Cloudflare rate limiter (worker.ts) and the OTP throttles.
 */
export function tooManyRequests(
  message = "Rate limit exceeded. Please slow down.",
  retryAfterSeconds = 60,
): Response {
  return error(
    WORKER_ERROR_CODES.TOO_MANY_REQUESTS,
    429,
    message,
    { headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

/**
 * Rejects non-WebSocket upgrades before the Durable Object accepts a socket.
 * Returns null when the request is a valid WS upgrade. Used by the stream
 * route (worker.ts) and the Durable Object entry (durable/stream-do.ts).
 */
export function guardWebSocketUpgrade(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  // HTTP header values are case-insensitive; a compliant client may send
  // "WebSocket" or "WEBSOCKET".
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
}

// ─── Reusable Guard Functions ────────────────────────────────────

/**
 * Validates that the request Content-Type matches what the route expects.
 * Prevents malformed payloads from causing unhandled exceptions.
 * Used by: worker.ts (JSON routes) and /transcribe (multipart).
 */
export function guardContentType(
  request: Request,
  expected: "json" | "multipart" = "json",
): GuardResult {
  const ct = request.headers.get("Content-Type") || "";
  const valid =
    expected === "json"
      ? ct.includes("application/json")
      : ct.includes("multipart/form-data");

  if (!valid) {
    logger.warn(
      `[security] Invalid Content-Type: "${ct}", expected: ${expected}`,
    );
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.INVALID_CONTENT_TYPE,
        415,
        expected === "json"
          ? "Expected application/json"
          : "Expected multipart/form-data"
      ),
    };
  }

  return { allowed: true };
}

/**
 * Reads a request body up to a byte cap, enforcing the limit even when the
 * client sends a chunked body with no (or a lying) Content-Length header.
 * Returns null when the body exceeds `maxBytes`; throws on stream I/O errors.
 */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);

  const contentLength = request.headers.get("Content-Length");
  const parsedLength = contentLength ? Number(contentLength) : NaN;
  if (!isNaN(parsedLength) && parsedLength > maxBytes) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Byte cap for JSON request bodies (translate, checkout, ...). Kept well under
 * the 128MB Workers request limit and sized for the largest legit payload
 * (a long translate request), not audio (audio goes via /transcribe multipart).
 */
export const MAX_JSON_BODY_BYTES = 128_000;

/**
 * Safely parses JSON from a request body, enforcing a byte cap while
 * streaming the body (chunked bodies without Content-Length are capped too).
 * Returns the parsed body or a 4xx response on malformed/oversized input.
 * Used by: /translate
 */
export async function safeParseJSON<T>(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readLimitedBody(request, maxBytes);
  } catch {
    logger.warn("[security] Failed to read JSON request body");
    return {
      ok: false,
      response: error(WORKER_ERROR_CODES.INVALID_JSON, 400, "Request body is not valid JSON."),
    };
  }

  if (bytes === null) {
    logger.warn(
      `[security] Rejected oversized JSON body (> ${Math.round(maxBytes / 1024)}KB)`,
    );
    return {
      ok: false,
      response: error(WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE, 413, `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`),
    };
  }

  try {
    const data = JSON.parse(new TextDecoder().decode(bytes)) as T;
    return { ok: true, data };
  } catch {
    logger.warn("[security] Malformed JSON in request body");
    return {
      ok: false,
      response: error(WORKER_ERROR_CODES.INVALID_JSON, 400, "Request body is not valid JSON."),
    };
  }
}

/**
 * Rejects text payloads that exceed the tier's character limit.
 * Used by: /translate
 */
export function guardTextLength(text: string, tier: Tier): GuardResult {
  const { maxTextChars } = getLimits(tier);

  if (text.length > maxTextChars) {
    logger.warn(
      `[security] Rejected text for tier ${tier}. Length: ${text.length} > Max: ${maxTextChars}`,
    );
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.TEXT_TOO_LONG, 413, `Text exceeds the ${maxTextChars} character limit.`),
    };
  }

  return { allowed: true };
}

/**
 * Rejects audio files that exceed the tier's byte-size limit.
 * Used by: /transcribe
 */
export function guardAudioSize(fileSize: number, tier: Tier): GuardResult {
  const { maxAudioBytes } = getLimits(tier);

  if (fileSize > maxAudioBytes) {
    logger.warn(
      `[security] Rejected audio for tier ${tier}. Size: ${fileSize} > Max: ${maxAudioBytes}`,
    );
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.FILE_TOO_LARGE, 413, "Audio file too large. Try a shorter recording."),
    };
  }

  return { allowed: true };
}

/**
 * Rejects audio whose reported duration exceeds the tier's dictation limit.
 * The client sends its decoded duration (ms) alongside the file, which catches
 * long, low-bitrate recordings that stay under the byte-size limit.
 * Used by: /transcribe. Unknown/absent durations pass through (older clients).
 */
export function guardAudioDuration(
  durationMs: number | undefined,
  tier: Tier,
): GuardResult {
  if (!durationMs || durationMs <= 0) return { allowed: true };

  const { dictationDurationMs } = getLimits(tier);

  if (durationMs > dictationDurationMs) {
    logger.warn(
      `[security] Rejected audio for tier ${tier}. Duration: ${durationMs} > Max: ${dictationDurationMs}`,
    );
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.AUDIO_TOO_LONG,
        413,
        `Audio is longer than the ${Math.round(dictationDurationMs / 60_000)} minute limit for your plan.`,
      ),
    };
  }

  return { allowed: true };
}

/**
 * Rejects auto-detect language requests from non-Pro users.
 * Used by: /transcribe AND /translate
 */
export function guardAutoDetect(
  lang: string | undefined | null,
  tier: Tier,
): GuardResult {
  const { autoDetectAllowed } = getLimits(tier);
  const isAuto = !lang || lang === "auto";

  if (isAuto && !autoDetectAllowed) {
    logger.warn(`[security] Rejected auto-detect for tier ${tier}`);
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.AUTO_DETECT_UNAVAILABLE,
        403,
        "Language auto-detect is not available. Please select a language.",
      ),
    };
  }

  return { allowed: true };
}

/**
 * Validates that a language code is in the known allowlist.
 * Prevents unknown codes from reaching LLM providers (which could
 * cause unexpected behavior or token waste).
 * Used by: /translate AND /transcribe
 */
export function guardLanguageCode(
  code: string | undefined | null,
  fieldName: string,
): GuardResult {
  if (!code) return { allowed: true };

  if (!VALID_LANG_CODES.has(code)) {
    logger.warn(
      `[security] Invalid language code: "${code}" for field: ${fieldName}`,
    );
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.INVALID_LANGUAGE, 400, `Unsupported language code: ${code}`),
    };
  }

  return { allowed: true };
}

/**
 * Rejects JSON request bodies that exceed a byte-size limit.
 * Uses Content-Length header when available (avoids reading the body).
 * Used by: /translate
 */
export function guardJsonSize(request: Request, maxBytes: number): GuardResult {
  const contentLength = request.headers.get("Content-Length");
  const parsedLength = contentLength ? Number(contentLength) : NaN;
  if (!isNaN(parsedLength) && parsedLength > maxBytes) {
    logger.warn(
      `[security] Rejected oversized JSON body. ` +
        `Content-Length: ${contentLength} > Max: ${maxBytes}`,
    );
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE, 413, `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`),
    };
  }
  return { allowed: true };
}

/**
 * Rejects oversized multipart bodies BEFORE they are buffered by request.formData().
 * Without this, an unbounded upload could exhaust memory before guardAudioSize runs.
 * Uses Content-Length (avoids reading the body). The file limit is the tier's
 * maxAudioBytes plus a generous margin for multipart framing/metadata overhead.
 * Used by: /transcribe
 */
export function guardMultipartSize(
  request: Request,
  tier: Tier,
  overheadBytes = MULTIPART_OVERHEAD,
): GuardResult {
  const contentLength = request.headers.get("Content-Length");
  const parsedLength = contentLength ? Number(contentLength) : NaN;
  if (isNaN(parsedLength)) {
    // No Content-Length (rare with FormData clients). We can't pre-guard
    // without buffering; rely on the post-buffer guardAudioSize instead.
    logger.debug(
      `[security] Multipart request without Content-Length for tier ${tier}; skipping pre-guard`,
    );
    return { allowed: true };
  }

  const { maxAudioBytes } = getLimits(tier);
  if (parsedLength > maxAudioBytes + overheadBytes) {
    logger.warn(
      `[security] Rejected oversized multipart for tier ${tier}. ` +
        `Content-Length: ${parsedLength} > Max: ${maxAudioBytes + overheadBytes}`,
    );
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.FILE_TOO_LARGE, 413, "Audio file too large. Try a shorter recording."),
    };
  }
  return { allowed: true };
}

/**
 * Guards streaming access — checks if the user's tier allows live streaming.
 * Used by: /transcribe/stream
 */
export function guardStreamingAllowed(tier: Tier): GuardResult {
  const { streamingAllowed } = getLimits(tier);

  if (!streamingAllowed) {
    logger.warn(`[security] Rejected streaming for tier ${tier}`);
    return {
      allowed: false,
      response: error(WORKER_ERROR_CODES.STREAM_PRO_ONLY, 403, "Live transcription is a Pro feature."),
    };
  }

  return { allowed: true };
}

/**
 * Guards streaming duration — checks if the session exceeds the tier's max duration.
 * Used by: /transcribe/stream
 */
export function guardStreamDuration(
  elapsedMs: number,
  tier: Tier,
): GuardResult {
  const { maxStreamDurationMs } = getLimits(tier);

  if (maxStreamDurationMs > 0 && elapsedMs > maxStreamDurationMs) {
    logger.warn(
      `[security] Stream duration exceeded for tier ${tier}: ${elapsedMs}ms > ${maxStreamDurationMs}ms`,
    );
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.STREAM_DURATION_EXCEEDED,
        403,
        `Stream duration limit of ${Math.round(maxStreamDurationMs / 1000)} seconds exceeded.`,
      ),
    };
  }

  return { allowed: true };
}