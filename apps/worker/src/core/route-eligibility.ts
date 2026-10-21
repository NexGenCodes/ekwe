import {
  sttLimits,
  ttsLimits,
  tttLimits,
  type AudioCodec,
} from "@ekwe/shared/providerLimits";
import {
  isLanguageSupported,
  type ProviderId,
} from "@ekwe/shared/languageCapabilities";
import { providerSupportsLanguage } from "@/providers";
import { logger } from "@/core/logger";

/**
 * Why a provider was not attempted. All decidable from the request and the
 * registry except `circuit-open`, which needs the health store.
 *
 * One union is what makes a skip countable — the reason travels into telemetry.
 */
export type SkipReason =
  | "circuit-open"
  | "no-auto-detect"
  | "unsupported-language"
  | "unsupported-codec"
  | "too-long"
  | "too-large"
  | "too-short"
  | "no-credential";

export interface SkipVerdict {
  readonly eligible: boolean;
  readonly reason?: SkipReason;
  readonly detail?: string;
}

function skip(reason: SkipReason, detail?: string): SkipVerdict {
  return detail === undefined
    ? { eligible: false, reason }
    : { eligible: false, reason, detail };
}

/**
 * A timeout is an outcome, not a precondition — modelling it as a skip would
 * permanently exclude the provider. It trips the breaker instead, and the
 * breaker surfaces here as `circuit-open` for the length of its window.
 *
 * Budget exhaustion is absent from this union deliberately: it is a fact about
 * the request, not a provider, so the failover loop owns it directly.
 */
export interface SttRequestShape {
  readonly lang: string;
  readonly isAuto: boolean;
  readonly codec: AudioCodec;
  readonly bytes: number;
  readonly durationMs: number;
}

export interface Attempt {
  readonly provider: string;
  readonly eligible: boolean;
  readonly reason?: SkipReason;
  readonly detail?: string;
}

/**
 * Decides which providers could serve this request, with no I/O. Pure, so the
 * skip matrix is testable without a live `env` or a full pipeline run.
 */
export function planSttRoute(
  pool: readonly string[],
  request: SttRequestShape,
): Attempt[] {
  return pool.map((provider) => {
    const limits = sttLimits(provider);

    if (!limits) {
      // Defaulting to "allowed" is how a new provider silently inherits calls
      // it cannot answer.
      return {
        provider,
        eligible: false,
        reason: "unsupported-codec" as SkipReason,
        detail: "no declared stt limits",
      };
    }

    if (request.isAuto && limits.autoDetect !== "supported") {
      return {
        provider,
        eligible: false,
        reason: "no-auto-detect" as SkipReason,
        detail: limits.autoDetect,
      };
    }

    if (
      !request.isAuto &&
      !providerSupportsLanguage(provider, "stt", request.lang)
    ) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-language" as SkipReason,
        detail: request.lang,
      };
    }

    if (
      limits.codecs !== "any" &&
      request.codec !== "unknown" &&
      !limits.codecs.includes(request.codec)
    ) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-codec" as SkipReason,
        detail: request.codec,
      };
    }

    if (limits.maxBytes !== Infinity && request.bytes > limits.maxBytes) {
      return {
        provider,
        eligible: false,
        reason: "too-large" as SkipReason,
        detail: `${request.bytes} > ${limits.maxBytes}`,
      };
    }

    if (request.durationMs > limits.maxDurationMs) {
      return {
        provider,
        eligible: false,
        reason: "too-long" as SkipReason,
        detail: `${request.durationMs}ms > ${limits.maxDurationMs}ms`,
      };
    }

    if (request.durationMs > 0 && request.durationMs < limits.minDurationMs) {
      return {
        provider,
        eligible: false,
        reason: "too-short" as SkipReason,
        detail: `${request.durationMs}ms < ${limits.minDurationMs}ms`,
      };
    }

    return { provider, eligible: true };
  });
}

export interface TttRequestShape {
  readonly targetLang: string;
  readonly textLength: number;
}

export function planTttRoute(
  pool: readonly string[],
  request: TttRequestShape,
): Attempt[] {
  return pool.map((provider) => {
    const limits = tttLimits(provider);

    if (!limits) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-language" as SkipReason,
        detail: "no declared ttt limits",
      };
    }

    if (
      !isLanguageSupported(provider as ProviderId, "ttt", request.targetLang)
    ) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-language" as SkipReason,
        detail: request.targetLang,
      };
    }

    if (request.textLength > limits.maxInputChars) {
      return {
        provider,
        eligible: false,
        reason: "too-long" as SkipReason,
        detail: `${request.textLength} > ${limits.maxInputChars} chars`,
      };
    }

    return { provider, eligible: true };
  });
}

export interface TtsRequestShape {
  readonly lang: string;
  readonly textLength: number;
}

export function planTtsRoute(
  pool: readonly string[],
  request: TtsRequestShape,
): Attempt[] {
  return pool.map((provider) => {
    const limits = ttsLimits(provider);

    if (!limits) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-language" as SkipReason,
        detail: "no declared tts limits",
      };
    }

    if (!providerSupportsLanguage(provider, "tts", request.lang)) {
      return {
        provider,
        eligible: false,
        reason: "unsupported-language" as SkipReason,
        detail: request.lang,
      };
    }

    if (request.textLength > limits.maxInputChars) {
      return {
        provider,
        eligible: false,
        reason: "too-long" as SkipReason,
        detail: `${request.textLength} > ${limits.maxInputChars} chars`,
      };
    }

    return { provider, eligible: true };
  });
}

/**
 * A request no provider can serve is a fault in the request, not an outage.
 * 503 tells the client to retry something that will never succeed, and reads as
 * a provider failure in every dashboard.
 */
export function exhaustedVerdict(
  attempts: readonly Attempt[],
): SkipVerdict | null {
  const eligible = attempts.filter((a) => a.eligible);
  if (eligible.length > 0) return null;

  // Most explanatory reason wins: "unsupported-codec" tells a developer what to
  // fix, "too-long" only tells them a number.
  const priority: readonly SkipReason[] = [
    "no-auto-detect",
    "unsupported-language",
    "unsupported-codec",
    "too-long",
    "too-large",
    "too-short",
    "no-credential",
  ];

  for (const reason of priority) {
    const hit = attempts.find((a) => a.reason === reason);
    if (hit) return skip(reason, hit.detail);
  }
  return null;
}

export function logSkips(route: string, attempts: readonly Attempt[]): void {
  for (const attempt of attempts) {
    if (attempt.eligible) continue;
    logger.info(
      `[${route}] Skipping ${attempt.provider} (${attempt.reason}${attempt.detail ? `: ${attempt.detail}` : ""})`,
    );
  }
}
