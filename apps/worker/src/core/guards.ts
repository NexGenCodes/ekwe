import { LANGUAGES, WORKER_ERROR_CODES } from "@ekwe/shared";
import {
  isLanguageSupported,
  providerIdsForCapability,
  type LanguageCapability,
} from "@ekwe/shared/languageCapabilities";
import { logger } from "@/core/logger";
import { error } from "@/core/http";
import { getLimits, type Tier } from "@/core/limits";

const VALID_LANG_CODES = new Set(["auto", ...LANGUAGES.map((l) => l.code)]);

interface GuardPass {
  allowed: true;
}
interface GuardFail {
  allowed: false;
  response: Response;
}
type GuardResult = GuardPass | GuardFail;

export const MULTIPART_OVERHEAD = 256 * 1024;

export function tooManyRequests(
  message = "Rate limit exceeded. Please slow down.",
  retryAfterSeconds = 60,
): Response {
  return error(WORKER_ERROR_CODES.TOO_MANY_REQUESTS, 429, message, {
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

export function guardWebSocketUpgrade(request: Request): Response | null {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  return null;
}

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
          : "Expected multipart/form-data",
      ),
    };
  }

  return { allowed: true };
}

export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);

  const contentLength = request.headers.get("Content-Length");
  const parsedLength = contentLength ? Number(contentLength) : NaN;
  if (!isNaN(parsedLength) && parsedLength > maxBytes) return null;

  const reader = request.body.getReader();

  // Fill one right-sized buffer when Content-Length is present, instead of
  // holding every chunk and then copying them into a contiguous one.
  let direct: Uint8Array<ArrayBuffer> | null =
    !isNaN(parsedLength) && parsedLength > 0
      ? new Uint8Array(parsedLength)
      : null;
  let chunks: Uint8Array[] | null = null;
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }

    if (direct && total + value.byteLength <= direct.length) {
      direct.set(value, total);
    } else {
      // Content-Length under-reported. Accumulate instead of writing past the
      // buffer, so we neither truncate a legitimate upload nor overrun.
      if (!chunks) {
        chunks = direct ? [direct.subarray(0, total)] : [];
        direct = null;
      }
      chunks.push(value);
    }
    total += value.byteLength;
  }

  if (direct) {
    // Over-reported Content-Length: return only what arrived.
    return total === direct.length ? direct : direct.slice(0, total);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks!) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export const MAX_JSON_BODY_BYTES = 128_000;

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
      response: error(
        WORKER_ERROR_CODES.INVALID_JSON,
        400,
        "Request body is not valid JSON.",
      ),
    };
  }

  if (bytes === null) {
    logger.warn(
      `[security] Rejected oversized JSON body (> ${Math.round(maxBytes / 1024)}KB)`,
    );
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE,
        413,
        `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`,
      ),
    };
  }

  try {
    const data = JSON.parse(new TextDecoder().decode(bytes)) as T;
    return { ok: true, data };
  } catch {
    logger.warn("[security] Malformed JSON in request body");
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.INVALID_JSON,
        400,
        "Request body is not valid JSON.",
      ),
    };
  }
}

export function guardTextLength(text: string, tier: Tier): GuardResult {
  const { maxTextChars } = getLimits(tier);

  if (text.length > maxTextChars) {
    logger.warn(
      `[security] Rejected text for tier ${tier}. Length: ${text.length} > Max: ${maxTextChars}`,
    );
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.TEXT_TOO_LONG,
        413,
        `Text exceeds the ${maxTextChars} character limit.`,
      ),
    };
  }

  return { allowed: true };
}

export function guardAudioSize(fileSize: number, tier: Tier): GuardResult {
  const { maxAudioBytes } = getLimits(tier);

  if (fileSize > maxAudioBytes) {
    logger.warn(
      `[security] Rejected audio for tier ${tier}. Size: ${fileSize} > Max: ${maxAudioBytes}`,
    );
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.FILE_TOO_LARGE,
        413,
        "Audio file too large. Try a shorter recording.",
      ),
    };
  }

  return { allowed: true };
}

/**
 * Opus will not encode speech below roughly this many bits per second, so a
 * file smaller than FLOOR_BITRATE * duration cannot actually hold that much
 * audio. Used to bound a client-declared duration, which is otherwise the only
 * thing standing between a caller and an arbitrarily long upload.
 */
const OPUS_FLOOR_BITRATE_BPS = 4_000;

export function guardAudioDuration(
  durationMs: number | undefined,
  tier: Tier,
  byteSize?: number,
): GuardResult {
  const { dictationDurationMs } = getLimits(tier);
  const declared = durationMs && durationMs > 0 ? durationMs : undefined;

  if (declared && declared > dictationDurationMs) {
    // A size that could not hold this much audio means the declaration is
    // false, so the limit has been evaded rather than genuinely exceeded.
    const floorMs =
      byteSize !== undefined
        ? (byteSize * 8 * 1000) / OPUS_FLOOR_BITRATE_BPS
        : 0;

    if (!byteSize || declared <= floorMs) {
      logger.warn(
        `[security] Rejected audio for tier ${tier}. Duration: ${declared} > Max: ${dictationDurationMs}`,
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
  }

  return { allowed: true };
}

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
      response: error(
        WORKER_ERROR_CODES.INVALID_LANGUAGE,
        400,
        `Unsupported language code: ${code}`,
      ),
    };
  }

  return { allowed: true };
}

/**
 * Catalog membership is not the same as being servable. A code can be a real
 * language that no provider transcribes, and only the capability registry knows
 * the difference.
 *
 * This is checked before any request is spent, because the alternative is
 * silently skipping every provider and reporting `EKWE_ALL_PROVIDERS_FAIL` —
 * which reads as an outage, tells the client to retry, and marks healthy
 * providers as failing. A language we cannot do is a 4xx about the request, not
 * a 503 about the service.
 */
export function guardSupportedLanguage(
  code: string | undefined | null,
  capability: LanguageCapability,
): GuardResult {
  if (!code || code === "auto") return { allowed: true };

  const servable = providerIdsForCapability(capability).some((id) =>
    isLanguageSupported(id, capability, code),
  );
  if (servable) return { allowed: true };

  logger.warn(`[guards] No provider serves ${capability} for "${code}"`);
  // The capability id is internal vocabulary; the message names the feature.
  const feature =
    capability === "stt"
      ? "transcription"
      : capability === "tts"
        ? "speech"
        : capability === "ttt"
          ? "translation"
          : capability;
  return {
    allowed: false,
    response: error(
      WORKER_ERROR_CODES.LANGUAGE_UNSUPPORTED,
      400,
      `No provider handles ${code} for ${feature}.`,
    ),
  };
}

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
      response: error(
        WORKER_ERROR_CODES.PAYLOAD_TOO_LARGE,
        413,
        `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`,
      ),
    };
  }
  return { allowed: true };
}

export function guardMultipartSize(
  request: Request,
  tier: Tier,
  overheadBytes = MULTIPART_OVERHEAD,
): GuardResult {
  const contentLength = request.headers.get("Content-Length");
  const parsedLength = contentLength ? Number(contentLength) : NaN;
  if (isNaN(parsedLength)) {
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
      response: error(
        WORKER_ERROR_CODES.FILE_TOO_LARGE,
        413,
        "Audio file too large. Try a shorter recording.",
      ),
    };
  }
  return { allowed: true };
}

export function guardStreamingAllowed(tier: Tier): GuardResult {
  const { streamingAllowed } = getLimits(tier);

  if (!streamingAllowed) {
    logger.warn(`[security] Rejected streaming for tier ${tier}`);
    return {
      allowed: false,
      response: error(
        WORKER_ERROR_CODES.STREAM_PRO_ONLY,
        403,
        "Live transcription is a Pro feature.",
      ),
    };
  }

  return { allowed: true };
}

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
