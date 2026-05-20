import { EkweError } from '@/constants/errors';
import { LANGUAGES } from '@/constants/languages';
import { supabase } from '@/services/supabase';
import { authActions } from '@/store';
import { Result, ok, err } from '@/types/Result';
import { fetchWithRetry } from '@/utils/networkUtils';
import logger from '@/utils/logger';

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? '';

export interface TranslationResult {
  translation: string;
  transliteration?: string;
  sourceLang: string;
  targetLang: string;
  provider?: string;
}

class TranslationServiceClass {
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
    const workerUrl = getWorkerUrl();
    if (workerUrl.length === 0) {
      return err(EkweError.NETWORK_LOST);
    }

    if (text.trim().length === 0) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

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

      const data = (await response.json()) as {
        translation: string;
        transliteration?: string;
        provider?: string;
        transaction?: {
          transactions_used: number;
          tier_active: 'FREE' | 'PREMIUM';
          is_fallback: boolean;
        };
      };

      if (data.transaction) {
        authActions.updateBilling(data.transaction);
      }

      if (
        data.translation === undefined ||
        data.translation.trim().length === 0
      ) {
        return err(EkweError.TRANSLATION_FAIL);
      }

      return ok({
        translation: data.translation.trim(),
        transliteration: data.transliteration?.trim(),
        sourceLang,
        targetLang,
        provider: data.provider,
      });
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
