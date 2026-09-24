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
} from "@/utils/http";

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
