import { LANGUAGES, languageName } from "@ekwe/shared";
import { logger } from "./logger";
import { getLimits } from "./config";
import { Tier } from "./types";

/**
 * ─── Ekwe Worker Security Module ──────────────────────────────────
 *
 * Every route handler imports from here instead of hardcoding values.
 *
 * If a malicious user tampers with the frontend (e.g. flipping isPro
 * in MMKV), these limits still apply because the Worker derives the
 * tier from the cryptographically signed Supabase JWT — not from
 * any client-supplied flag.
 *
 * ── Enforcement Layers ──
 *   1. Rate Limiter      → Cloudflare binding (index.ts)
 *   2. Preflight Check   → Atomic cooldown via Supabase RPC (index.ts)
 *   3. Payload Guards     → This file (called by transcribe/translate)
 */

// ─── Valid Language Codes (allowlist) ─────────────────────────────
// Derived from the shared LANGUAGES constant. Any code not in this
// set is rejected before it reaches an LLM provider.

const VALID_LANG_CODES = new Set(["auto", ...LANGUAGES.map((l) => l.code)]);

export function getLanguageName(code: string | undefined | null): string {
  if (!code || code === "auto") return "auto-detected language";
  return languageName(code);
}

// ─── Prompt Injection Patterns ───────────────────────────────────
// Common prompt injection markers that attempt to override LLM system prompts.
// These are stripped silently — the user still gets a translation, just without
// the injected payload.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+your\s+(instructions?|prompts?|rules?)/gi,
  /you\s+are\s+(now|a|an)\s+/gi,
  /act\s+as\s+(a|an)\s+/gi,
  /pretend\s+(you('re|\s+are)\s+)/gi,
  /system\s*prompt/gi,
  /system\s+message/gi,
  /developer\s+message/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<system>/gi,
  /<\\?system\\?>/gi,
  /(?:now\s+)?(?:output|reply|respond)\s+(?:only\s+)?(?:in\s+)?(?:json|markdown|html)/gi,
  /\[SYS\]/gi,
  /\[\/SYS\]/gi,
  /do\s+not\s+(?:follow|obey)\s+previous/gi,
];

// ─── Guard Results ───────────────────────────────────────────────

interface GuardPass {
  allowed: true;
}
interface GuardFail {
  allowed: false;
  response: Response;
}
type GuardResult = GuardPass | GuardFail;

// ─── Reusable Guard Functions ────────────────────────────────────

/**
 * Validates that the request Content-Type matches what the route expects.
 * Prevents malformed payloads from causing unhandled exceptions.
 * Used by: index.ts (before routing)
 */
export function guardContentType(
  request: Request,
  expected: "json" | "multipart",
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
      response: Response.json(
        {
          error: "INVALID_CONTENT_TYPE",
          message: `Expected ${expected === "json" ? "application/json" : "multipart/form-data"}`,
        },
        { status: 415 },
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
 * Safely parses JSON from a request body, enforcing a byte cap while
 * streaming the body (chunked bodies without Content-Length are capped too).
 * Returns the parsed body or a 4xx response on malformed/oversized input.
 * Used by: /translate, /checkout/initialize
 */
export async function safeParseJSON<T>(
  request: Request,
  maxBytes = 128_000,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let bytes: Uint8Array | null;
  try {
    bytes = await readLimitedBody(request, maxBytes);
  } catch {
    logger.warn("[security] Failed to read JSON request body");
    return {
      ok: false,
      response: Response.json(
        { error: "INVALID_JSON", message: "Request body is not valid JSON." },
        { status: 400 },
      ),
    };
  }

  if (bytes === null) {
    logger.warn(
      `[security] Rejected oversized JSON body (> ${Math.round(maxBytes / 1024)}KB)`,
    );
    return {
      ok: false,
      response: Response.json(
        {
          error: "PAYLOAD_TOO_LARGE",
          message: `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`,
        },
        { status: 413 },
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
      response: Response.json(
        { error: "INVALID_JSON", message: "Request body is not valid JSON." },
        { status: 400 },
      ),
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
      response: Response.json(
        {
          error: "TEXT_TOO_LONG",
          message: `Text exceeds the ${maxTextChars} character limit.`,
        },
        { status: 413 },
      ),
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
      response: Response.json(
        {
          error: "FILE_TOO_LARGE",
          message: `Audio file too large. Try a shorter recording.`,
        },
        { status: 413 },
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
      response: Response.json(
        {
          error: "AUTO_DETECT_UNAVAILABLE",
          message:
            "Language auto-detect is not available. Please select a language.",
        },
        { status: 403 },
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
      response: Response.json(
        {
          error: "INVALID_LANGUAGE",
          message: `Unsupported language code: ${code}`,
        },
        { status: 400 },
      ),
    };
  }

  return { allowed: true };
}

/**
 * Rejects JSON request bodies that exceed a byte-size limit.
 * Uses Content-Length header when available (avoids reading the body).
 * Used by: /translate, /checkout/initialize
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
      response: Response.json(
        {
          error: "PAYLOAD_TOO_LARGE",
          message: `Request body exceeds ${Math.round(maxBytes / 1024)}KB limit.`,
        },
        { status: 413 },
      ),
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
  overheadBytes = 256 * 1024,
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
      response: Response.json(
        {
          error: "FILE_TOO_LARGE",
          message: `Audio file too large. Try a shorter recording.`,
        },
        { status: 413 },
      ),
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
      response: new Response(
        JSON.stringify({
          error: "STREAM_PRO_ONLY",
          message: "Live transcription is a Pro feature.",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
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
      response: new Response(
        JSON.stringify({
          error: "STREAM_DURATION_EXCEEDED",
          message: `Stream duration limit of ${Math.round(maxStreamDurationMs / 1000)} seconds exceeded.`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  return { allowed: true };
}

export function sanitizeTranslationText(text: string): string {
  // Strip Unicode bidi control characters (can be used to spoof/hide injected text).
  let sanitized = text.replace(
    /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g,
    "",
  );
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.replace(/\s{3,}/g, "  ").trim();
}
