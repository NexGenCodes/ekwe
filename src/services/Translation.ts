import { z } from 'zod';

import { EkweError } from '@/constants/errors';
import { supabase } from '@/services/supabase';
import { authActions } from '@/store';
import { Result, ok, err } from '@/types/Result';
import logger from '@/utils/logger';
import { fetchWithRetry } from '@/utils/networkUtils';

const translationResponseSchema = z.object({
  translation: z.string(),
  transliteration: z.string().optional(),
  provider: z.string().optional(),
  transaction: z
    .object({
      transactions_used: z.unknown().transform((v) => Number(v) || 0),
      tier_active: z
        .unknown()
        .transform((v) =>
          typeof v === 'string' && v.toUpperCase() === 'PREMIUM'
            ? 'PREMIUM'
            : 'FREE',
        ),
      is_fallback: z.unknown().transform((v) => Boolean(v)),
    })
    .nullish()
    .catch(undefined),
});

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? '';

// Client-side rate limiting to prevent UI/server spam
let _lastTranslateTime = 0;
const TRANSLATE_RATE_LIMIT_MS = 1000; // 1 second between translation requests

export interface TranslationResult {
  translation: string;
  transliteration?: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
}

class TranslationServiceClass {
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cache = new Map<
    string,
    { value: Result<TranslationResult, EkweError>; timestamp: number }
  >();

  clearCache(): void {
    this.cache.clear();
    logger.info('[Translation] Cache cleared');
  }

  /**
   * Translates a transcript string from sourceLang to targetLang.
   * Routes through the Worker which tries Groq then DeepSeek.
   */
  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
    signal?: AbortSignal,
  ): Promise<Result<TranslationResult, EkweError>> {
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

    const cacheKey = `${trimmedText}_${sourceLang}_${targetLang}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      logger.info('[Translation] Frontend Cache Hit');
      return cached.value;
    }
    if (cached) this.cache.delete(cacheKey);

    const workerUrl = getWorkerUrl();
    if (workerUrl.length === 0) {
      return err(EkweError.NETWORK_LOST);
    }

    // Client-side rate limiting
    const now = Date.now();
    if (now - _lastTranslateTime < TRANSLATE_RATE_LIMIT_MS) {
      logger.warn('[Translation] Rate limited - please wait');
      return err(EkweError.RATE_LIMITED);
    }
    _lastTranslateTime = now;

    // Get auth token
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    try {
      const response = await fetchWithRetry(`${workerUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          targetLang,
          sourceLang,
        }),
        retries: 2, // Translations are smaller, don't need heavy retries
        signal,
      });

      if (!response.ok) {
        let errorCode = 'EKWE_TRANSLATION_FAIL';
        try {
          const errorBody = (await response.json()) as { error?: string };
          errorCode = errorBody.error ?? errorCode;
        } catch {
          /* ignore parse failures on error body */
        }

        if (response.status === 429) {
          return err(EkweError.RATE_LIMITED);
        }
        return this.mapErrorCode(errorCode);
      }

      const json = await response.json();
      const parsed = translationResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.error(
          '[Translation] Response validation failed:',
          parsed.error.message,
        );
        return err(EkweError.TRANSLATION_FAIL);
      }

      const data = parsed.data;

      if (data.transaction) {
        authActions.updateBilling(data.transaction);
      }

      if (data.translation.trim().length === 0) {
        return err(EkweError.TRANSLATION_FAIL);
      }

      const resultValue = ok({
        translation: data.translation.trim(),
        transliteration: data.transliteration?.trim(),
        sourceLang,
        targetLang,
        provider: data.provider,
      });

      this.cache.set(cacheKey, { value: resultValue, timestamp: Date.now() });
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.delete(firstKey);
        }
      }

      return resultValue;
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.name === 'AbortError') {
          throw e;
        }
        logger.error('[Translation] FAIL:', e.message);
      }
      return err(EkweError.NETWORK_LOST);
    }
  }

  private mapErrorCode(code: string): Result<never, EkweError> {
    const map: Record<string, EkweError> = {
      EKWE_NETWORK_LOST: EkweError.NETWORK_LOST,
      EKWE_ALL_PROVIDERS_FAIL: EkweError.ALL_PROVIDERS_FAIL,
      EKWE_EMPTY_TRANSCRIPT: EkweError.EMPTY_TRANSCRIPT,
      EKWE_TRANSLATION_FAIL: EkweError.TRANSLATION_FAIL,
    };
    return err(map[code] ?? EkweError.TRANSLATION_FAIL);
  }
}

export const TranslationService = new TranslationServiceClass();
