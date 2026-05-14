import { Env, TranscribeResult } from '../types';
import { rotateKeys, fetchWithTimeout, TIMEOUT_SLOW } from '../utils';
import { logger } from '../logger';

/**
 * Azure Cognitive Services Speech-to-Text — 5 hrs/mo per key.
 * Multi-key rotation to multiply capacity.
 * Language-locked per request (no auto-detect in free tier).
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const region = (env.AZURE_REGION as string) || 'eastus';
  const azureLang = resolveAzureLocale(lang);

  const res = await rotateKeys(
    env,
    'AZURE_KEY_',
    (key) => fetchWithTimeout(
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${azureLang}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'audio/ogg; codecs=opus',
          'Accept': 'application/json',
        },
        body: blob,
      },
      TIMEOUT_SLOW,
      signal,
    ),
    signal,
  );

  if (!res?.ok) {
    const errText = await res?.text().catch(() => '') || 'No response';
    logger.error('[azure] Transcribe HTTP error', { status: res?.status, body: errText });
    return null;
  }

  const data = await res.json() as AzureResponse;
  if (data.RecognitionStatus !== 'Success' || !data.DisplayText?.trim()) {
    return null;
  }

  return { text: data.DisplayText.trim(), provider: 'azure-stt' };
}

/**
 * Azure requires full BCP-47 locale codes (e.g. "en-US", "fr-FR").
 * Maps our 2-letter ISO codes to sensible Azure defaults.
 */
function resolveAzureLocale(lang: string): string {
  if (!lang || lang === 'auto') return 'en-US';

  const localeMap: Record<string, string> = {
    en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE',
    pt: 'pt-BR', it: 'it-IT', nl: 'nl-NL', ja: 'ja-JP',
    ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA', hi: 'hi-IN',
    yo: 'yo-NG', ig: 'ig-NG', ha: 'ha-NG', sw: 'sw-KE',
    ru: 'ru-RU', tr: 'tr-TR', pl: 'pl-PL', uk: 'uk-UA',
  };

  const base = lang.toLowerCase().split('-')[0];
  return localeMap[base] || `${base}-${base.toUpperCase()}`;
}

interface AzureResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  Offset?: number;
  Duration?: number;
}

export const supportsAutoLang = false;
