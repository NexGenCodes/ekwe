import {
  translateRequestSchema,
  translateResponseSchema,
  WORKER_ERROR_CODES,
} from "@ekwe/shared";
import type { TranslateRequest, TranslateResponse } from "@ekwe/shared";

import { EkweError } from "@/constants/errors";
import { supabase } from "@/services/supabase";
import { Result, ok, err } from "@/types/Result";
import { AnalyticsEvents, track } from "@/utils/analytics";
import logger from "@/utils/logger";
import {
  fetchWithRetry,
  getWorkerUrl,
  mapWorkerError,
  isOfflineNetworkError,
  isTimeoutError,
} from "@/utils/networkUtils";

// The wire fields come straight from the shared zod schema; sourceLang/targetLang
// are echoed back to the caller for convenience.
export type TranslationResult = TranslateResponse & {
  sourceLang: string;
  targetLang: string;
};

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<Result<TranslationResult, EkweError>> {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return err(EkweError.EMPTY_TRANSCRIPT);
  }

  const workerUrl = getWorkerUrl();
  if (workerUrl.length === 0) {
    return err(EkweError.NETWORK_LOST);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;

  const payload: TranslateRequest = { text, targetLang, sourceLang };
  // Fail fast client-side instead of spending a fetch round-trip on a shape
  // the worker would reject anyway (keeps the two sides in lockstep).
  const shapeCheck = translateRequestSchema.safeParse(payload);
  if (!shapeCheck.success) {
    return err(EkweError.TRANSLATION_FAIL);
  }

  try {
    const response = await fetchWithRetry(`${workerUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      retries: 2,
      timeout: 60000,
      signal,
      // The worker already tried every LLM provider before returning 5xx;
      // retrying would double the provider spend for no extra chance of success.
      retryOnHttpResponse: false,
    });

    if (!response.ok) {
      let errorCode = "EKWE_TRANSLATION_FAIL";
      try {
        const errorBody = (await response.json()) as { error?: string };
        errorCode = errorBody.error ?? errorCode;
      } catch {
        /* ignore parse failures on error body */
      }

      if (response.status === 429) {
        // The worker returns 429 for BOTH the cooldown gate (EKWE_RATE_LIMIT)
        // and the daily quota (EKWE_QUOTA_EXCEEDED) — surface them distinctly
        // so the UI can explain "limit reached" instead of "busy, retry".
        if (errorCode === WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED) {
          trackTranslationFailed(sourceLang, targetLang, "quota_exceeded");
          return err(EkweError.QUOTA_EXCEEDED);
        }
        trackTranslationFailed(sourceLang, targetLang, "rate_limited");
        return err(EkweError.RATE_LIMITED);
      }
      trackTranslationFailed(sourceLang, targetLang, "worker_error");
      return err(mapWorkerError(errorCode, EkweError.TRANSLATION_FAIL));
    }

    const json = await response.json();
    const parsed = translateResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.error(
        "[translateText] Response validation failed:",
        parsed.error.message,
      );
      trackTranslationFailed(sourceLang, targetLang, "invalid_response");
      return err(EkweError.TRANSLATION_FAIL);
    }

    const data = parsed.data;

    if (data.translation.trim().length === 0) {
      trackTranslationFailed(sourceLang, targetLang, "empty_translation");
      return err(EkweError.TRANSLATION_FAIL);
    }

    track(AnalyticsEvents.TRANSLATION_COMPLETED, {
      sourceLang,
      targetLang,
      provider: data.provider,
      chars: trimmedText.length,
    });

    return ok({
      translation: data.translation.trim(),
      transliteration: data.transliteration?.trim(),
      language: data.language,
      sourceLang,
      targetLang,
      provider: data.provider,
    });
  } catch (e: unknown) {
    // A definitive offline signal short-circuits the request before any fetch
    // (fail-fast in fetchWithRetry) — map it quietly, no error log needed.
    if (isOfflineNetworkError(e)) {
      trackTranslationFailed(sourceLang, targetLang, "offline");
      return err(EkweError.NETWORK_LOST);
    }
    if (isTimeoutError(e)) {
      logger.info("[translateText] Request timed out");
      trackTranslationFailed(sourceLang, targetLang, "timeout");
      return err(EkweError.TRANSLATION_FAIL);
    }
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        throw e;
      }
      logger.warn("[translateText] FAIL:", e.message);
    }
    trackTranslationFailed(sourceLang, targetLang, "network_error");
    return err(EkweError.NETWORK_LOST);
  }
}

function trackTranslationFailed(
  sourceLang: string,
  targetLang: string,
  reason: string,
): void {
  track(AnalyticsEvents.TRANSLATION_FAILED, {
    sourceLang,
    targetLang,
    reason,
  });
}
