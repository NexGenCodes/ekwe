import { EkweError } from '@/constants/errors';
import { LANGUAGES } from '@/constants/languages';
import { Result, ok, err } from '@/types/Result';
import { fetchWithRetry } from '@/utils/networkUtils';

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? '';

export interface TranslationResult {
  translation: string;
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

    // Resolve language names for the prompt
    const targetName = this.getLanguageName(targetLang);
    const sourceName = this.getLanguageName(sourceLang);

    try {
      const response = await fetchWithRetry(`${workerUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          targetLang: targetName,
          sourceLang: sourceName,
        }),
        retries: 2, // Translations are smaller, don't need heavy retries
        signal,
      });

      if (!response.ok) {
        const body = (await response.json()) as {
          error?: string;
        };
        return this.mapErrorCode(body.error ?? 'EKWE_TRANSLATION_FAIL');
      }

      const data = (await response.json()) as {
        translation: string;
        provider?: string;
        transaction?: {
          transactions_used: number;
          tier_active: 'FREE' | 'PREMIUM';
          is_fallback: boolean;
        };
      };

      if (data.transaction) {
        // Update global billing state dynamically
        const { useAuthStore } = require('@/store/authStore');
        useAuthStore.getState().updateBilling(data.transaction);
      }

      if (
        data.translation === undefined ||
        data.translation.trim().length === 0
      ) {
        return err(EkweError.TRANSLATION_FAIL);
      }

      return ok({
        translation: data.translation.trim(),
        sourceLang,
        targetLang,
        provider: data.provider,
      });
    } catch {
      return err(EkweError.NETWORK_LOST);
    }
  }

  private getLanguageName(code: string): string {
    return LANGUAGES.find((l) => l.code === code)?.englishName ?? code;
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
