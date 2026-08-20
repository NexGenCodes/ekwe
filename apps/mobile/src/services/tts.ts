import { File, Paths } from "expo-file-system";

import { EkweError } from "@/constants/errors";
import { supabase } from "@/services/supabase";
import { settings$ } from "@/store/settings";
import { Result, ok, err } from "@/types/Result";
import logger from "@/utils/logger";
import { isDefinitelyOffline } from "@/utils/netInfo";
import {
  mapWorkerError,
  getWorkerUrl,
  healProSession,
} from "@/utils/networkUtils";
import { TTS_MAX_TEXT_CHARS } from "@ekwe/shared/plans";
import type { TtsRequest } from "@ekwe/shared";

// The worker's TTS pipeline may chain providers up to ~20s; give the client a
// little headroom before it gives up and falls back to device speech.
const TTS_REQUEST_TIMEOUT_MS = 25_000;

export interface TtsAudio {
  uri: string;
}

const getExtension = (contentType: string): string => {
  if (/audio\/wav|audio\/x-wav|audio\/wave/i.test(contentType)) return "wav";
  return "mp3";
};

/**
 * Synthesizes speech for `text` in `lang` via the cloud TTS pipeline
 * (`POST /tts`, premium-gated on the worker). The returned audio is saved to a
 * temp cache file and can be played with any expo-audio player.
 *
 * Failure is the expected path for free-tier users (403 PREMIUM_FEATURE_REQUIRED)
 * and for transient cloud outages — callers should treat any error here as "use
 * on-device speech instead".
 */
export async function synthesizeSpeech(
  text: string,
  lang: string,
  signal?: AbortSignal,
): Promise<Result<TtsAudio, EkweError>> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TTS_MAX_TEXT_CHARS) {
    return err(EkweError.TTS_FAIL);
  }
  if (isDefinitelyOffline()) {
    return err(EkweError.NETWORK_LOST);
  }

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    logger.error("[tts] workerUrl is EMPTY!");
    return err(EkweError.NETWORK_LOST);
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    let token = session?.access_token;

    const performRequest = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        TTS_REQUEST_TIMEOUT_MS,
      );
      const onAbort = (): void => controller.abort();
      signal?.addEventListener("abort", onAbort);

      try {
        return await fetch(`${workerUrl}/tts`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            text: trimmed,
            lang,
            gender: ((): "male" | "female" | undefined => {
              const v = settings$.ttsVoice.peek();
              return v === "default" ? undefined : v;
            })(),
          } satisfies TtsRequest),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      }
    };

    let response = await performRequest();

    // 403 = premium-only feature. Expected for free users — the caller falls
    // back to on-device speech without surfacing an error. BUT a Pro user can
    // hit this too when their JWT predates the webhook → user_subscriptions
    // sync (the token hook only re-mints `is_pro` on a new token). If the
    // client believes Pro, refresh the session once (re-mints is_pro) and
    // retry before giving up.
    if (response.status === 403) {
      logger.info("[tts] 403: premium feature required (tier not PREMIUM)");
      if (await healProSession()) {
        const {
          data: { session: freshSession },
        } = await supabase.auth.getSession();
        token = freshSession?.access_token;
        response = await performRequest();
      }
    }

    if (response.status >= 400) {
      let errorCode = "EKWE_TTS_FAIL";
      try {
        const errorBody = await response.text();
        const parsed = JSON.parse(errorBody) as { error?: string };
        errorCode = parsed.error ?? errorCode;
      } catch {
        // ignore parse failures on error body
      }
      logger.error("[tts] FAIL: non-ok response", response.status, errorCode);
      return err(mapWorkerError(errorCode, EkweError.TTS_FAIL));
    }

    const contentType = response.headers.get("content-type") ?? "";
    const extension = getExtension(contentType);

    const bytes = await response.arrayBuffer();

    const cacheDir = Paths.cache.uri;
    if (!cacheDir) return err(EkweError.TTS_FAIL);

    const outputPath = `${cacheDir}ekwe_tts_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;
    const file = new File(outputPath);
    if (!file.exists) file.create({ intermediates: true });
    file.write(new Uint8Array(bytes));

    return ok({ uri: outputPath });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      logger.info("[tts] Request was aborted");
      return err(EkweError.INTERRUPTED);
    }
    logger.error("[tts] FAIL: exception", e);
    return err(EkweError.NETWORK_LOST);
  }
}
