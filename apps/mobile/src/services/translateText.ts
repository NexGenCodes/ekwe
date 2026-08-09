import { z } from "zod";

import { EkweError } from "@/constants/errors";
import { supabase } from "@/services/supabase";
import { Result, ok, err } from "@/types/Result";
import logger from "@/utils/logger";
import {
  fetchWithRetry,
  mapWorkerError,
  isOfflineNetworkError,
} from "@/utils/networkUtils";

const translationResponseSchema = z.object({
  translation: z.string(),
  transliteration: z.string().optional(),
  language: z.string().optional(),
  provider: z.string().optional(),
});

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? "";

export interface TranslationResult {
  translation: string;
  transliteration?: string;
  language?: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
}

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

  try {
    const response = await fetchWithRetry(`${workerUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text,
        targetLang,
        sourceLang,
      }),
      retries: 2,
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
        return err(EkweError.RATE_LIMITED);
      }
      return err(mapWorkerError(errorCode, EkweError.TRANSLATION_FAIL));
    }

    const json = await response.json();
    const parsed = translationResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.error(
        "[translateText] Response validation failed:",
        parsed.error.message,
      );
      return err(EkweError.TRANSLATION_FAIL);
    }

    const data = parsed.data;

    if (data.translation.trim().length === 0) {
      return err(EkweError.TRANSLATION_FAIL);
    }

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
      return err(EkweError.NETWORK_LOST);
    }
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        throw e;
      }
      logger.error("[translateText] FAIL:", e.message);
    }
    return err(EkweError.NETWORK_LOST);
  }
}
