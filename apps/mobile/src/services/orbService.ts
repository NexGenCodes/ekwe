import { File as ExpoFile, Paths } from "expo-file-system";
import { isAndroid } from "@/utils/platform";
import {
  HistoryService,
  type HistoryEntryPayload,
} from "@/services/historyService";
import {
  transcribeAudio,
  type TranscriptionResult,
} from "@/services/transcribeAudio";
import { Result, ok, err } from "@/types/Result";
import { EkweError } from "@/constants/errors";
import { auth$, settings$ } from "@/store";
import logger from "@/utils/logger";
import { ensureAccessToken } from "@/services/backend";
import { getWorkerUrl } from "@/utils/http";
import { translateText } from "@/services/translateText";
import EkweNative from "../../modules/ekwe-native";
import type {
  OrbStatus,
  SimpleResult,
} from "../../modules/ekwe-native/src/EkweNative.types";

export interface OrbSession {
  captureId: string;
  outputPath: string;
  startTime: number;
  live?: boolean;
}

export interface OrbStopResult {
  transcript: string;
  translation?: string | null;
  sourceLang: string;
  targetLang: string;
  historyId?: string;
}

export const OrbService = {
  checkOverlayPermission: async (): Promise<boolean> => {
    if (!isAndroid) return false;
    return (await EkweNative.checkOverlayPermission?.()) ?? false;
  },

  requestOverlayPermission: async (): Promise<boolean> => {
    if (!isAndroid) return false;
    return (await EkweNative.requestOverlayPermission?.()) ?? false;
  },

  getStatus: async (): Promise<OrbStatus | null> => {
    if (!isAndroid) return null;
    return (await EkweNative.getOrbStatus?.()) ?? null;
  },

  consumeAction: async (): Promise<string | null> => {
    if (!isAndroid) return null;
    return (await EkweNative.consumeOrbAction?.()) ?? null;
  },

  setBubbleText: async (text: string): Promise<void> => {
    if (!isAndroid) return;
    try {
      await EkweNative.updateOrbText?.(text);
    } catch (e) {
      logger.warn("[OrbService] updateOrbText failed:", e);
    }
  },

  setResultText: async (text: string): Promise<void> => {
    if (!isAndroid) return;
    try {
      await EkweNative.setOrbResult?.(text);
    } catch (e) {
      logger.warn("[OrbService] setOrbResult failed:", e);
    }
  },

  dismissPanel: async (): Promise<void> => {
    if (!isAndroid) return;
    try {
      await EkweNative.dismissOrbPanel?.();
    } catch (e) {
      logger.warn("[OrbService] dismissOrbPanel failed:", e);
    }
  },

  stopNative: async (): Promise<void> => {
    if (!isAndroid) return;
    try {
      await EkweNative.stopOrbCapture?.();
    } catch (e) {
      logger.warn("[OrbService] stopNative failed:", e);
    }
  },

  dismissLoader: async (): Promise<void> => {
    if (!isAndroid) return;
    try {
      await EkweNative.dismissOrbLoader?.();
    } catch (e) {
      logger.warn("[OrbService] dismissOrbLoader failed:", e);
    }
  },

  readPendingCapturePath: async (): Promise<string | null> => {
    if (!isAndroid) return null;
    try {
      const marker = new ExpoFile(`${Paths.cache.uri}ekwe_orb_pending.txt`);
      if (!marker.exists) return null;
      const path = (await marker.text()).trim();
      return path || null;
    } catch (e) {
      logger.warn("[OrbService] readPendingCapturePath failed:", e);
      return null;
    }
  },

  clearPendingCapturePath: async (): Promise<void> => {
    if (!isAndroid) return;
    try {
      const marker = new ExpoFile(`${Paths.cache.uri}ekwe_orb_pending.txt`);
      if (marker.exists) marker.delete();
    } catch (e) {
      logger.warn("[OrbService] clearPendingCapturePath failed:", e);
    }
  },

  configure: async (config: {
    orbEnabled?: boolean;
    orbAutoArm?: boolean;
    myLanguages?: string[];
    sourceLang?: string;
    targetLang?: string;
  }): Promise<boolean> => {
    if (!isAndroid) return false;
    return (await EkweNative.configureOrb?.(config)) ?? false;
  },

  startCapture: async (options?: {
    isLive?: boolean;
    sourceLang?: string;
  }): Promise<Result<OrbSession, EkweError>> => {
    if (!isAndroid) {
      return err(EkweError.BAD_FORMAT);
    }
    if (!auth$.session.peek() || !auth$.isPro.peek()) {
      return err(EkweError.PREMIUM_REQUIRED);
    }

    const captureId = `orb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = `${Paths.cache.uri}ekwe_orb_${captureId}.ogg`;
    const live = options?.isLive ?? true;
    const sourceLang =
      options?.sourceLang ?? settings$.orbSourceLang.peek() ?? "auto";

    let stream:
      | { enabled: boolean; wsUrl?: string; token?: string; lang?: string }
      | undefined;
    if (live) {
      try {
        const token = await ensureAccessToken();
        const base = getWorkerUrl();
        if (token && base) {
          const wsBase = base.replace(/^http/, "ws");
          stream = {
            enabled: true,
            wsUrl: `${wsBase}/transcribe/stream?lang=${encodeURIComponent(sourceLang)}`,
            token,
            lang: sourceLang,
          };
        }
      } catch (e) {
        logger.warn("[OrbService] live stream setup failed, falling back", e);
      }
    }

    try {
      const res: SimpleResult | undefined = await EkweNative.startOrbCapture?.(
        outputPath,
        live,
        stream,
      );
      if (!res?.success) {
        logger.error("[OrbService] startOrbCapture failed:", res?.error);
        return err(EkweError.AUDIO_RECORD_FAIL);
      }
      return ok({
        captureId,
        outputPath,
        startTime: Date.now(),
        live: !!stream?.enabled,
      });
    } catch (e) {
      logger.error("[OrbService] startCapture exception:", e);
      return err(EkweError.AUDIO_RECORD_FAIL);
    }
  },

  stopCapture: async (
    session: OrbSession,
    options?: {
      sourceLang?: string;
      targetLang?: string;
      sessionUser?: { user?: { id: string } } | null;
    },
  ): Promise<Result<OrbStopResult, EkweError>> => {
    if (!isAndroid) {
      return err(EkweError.BAD_FORMAT);
    }

    try {
      await EkweNative.stopOrbCapture?.();
    } catch (e) {
      logger.warn("[OrbService] stopOrbCapture call failed:", e);
    }

    // Allow native capture/stream to flush and emit trailing finals.
    let status = await EkweNative.getOrbStatus?.();
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      status = await EkweNative.getOrbStatus?.();
      const stillActive = !!(status?.running || status?.streaming);
      const hasText =
        !!(status?.liveFinal && status.liveFinal.trim()) ||
        !!(status?.liveText && status.liveText.trim()) ||
        !!(status?.resultText && status.resultText.trim());
      if (!stillActive && hasText) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    status = (await EkweNative.getOrbStatus?.()) ?? status;

    const liveText =
      (status?.liveFinal && status.liveFinal.trim()) ||
      (status?.liveText && status.liveText.trim()) ||
      (status?.resultText && status.resultText.trim()) ||
      "";
    const durationMs = Math.max(0, Date.now() - session.startTime);
    const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
    const sourceApp = status?.foregroundApp ?? null;
    const requestedSourceLang = options?.sourceLang ?? "auto";
    const targetLang = options?.targetLang ?? "en";
    const detectedSourceLang =
      status?.detectedLang?.trim() ||
      (requestedSourceLang !== "auto" ? requestedSourceLang : "auto");
    const effectiveSourceLang = detectedSourceLang || requestedSourceLang;

    if (session.live || status?.streaming || liveText) {
      await OrbService.clearPendingCapturePath();
      if (!liveText) {
        return err(EkweError.EMPTY_TRANSCRIPT);
      }

      let translation: string | null = null;
      let mtProvider: string | null = null;
      const shouldTranslate =
        targetLang &&
        targetLang !== "auto" &&
        effectiveSourceLang !== "auto" &&
        targetLang !== effectiveSourceLang;
      if (shouldTranslate) {
        try {
          const tr = await translateText(
            liveText,
            effectiveSourceLang,
            targetLang,
          );
          if (tr.ok) {
            translation = tr.value.translation || null;
            mtProvider = tr.value.provider || null;
          }
        } catch (e) {
          logger.warn("[OrbService] live translation failed:", e);
        }
      }

      let historyId: string | undefined;
      if (options?.sessionUser?.user) {
        const payload: HistoryEntryPayload = {
          captureId: session.captureId,
          origin: "orb",
          input: "audio",
          sourceLang: effectiveSourceLang,
          targetLang,
          transcript: liveText,
          translation,
          transliteration: null,
          duration: durationSeconds,
          sourceApp,
          voiceId: null,
          sttProvider: "stream",
          mtProvider,
          type: "transcription",
        };
        try {
          historyId = await HistoryService.recordTranslation(
            payload,
            options.sessionUser,
          );
        } catch (e) {
          logger.warn("[OrbService] Failed to record history entry:", e);
        }
      }
      return ok({
        transcript: liveText,
        translation,
        sourceLang: effectiveSourceLang,
        targetLang,
        historyId,
      });
    }

    const file = new ExpoFile(session.outputPath);
    if (!file.exists || file.size === 0) {
      await OrbService.clearPendingCapturePath();
      return err(EkweError.AUDIO_EMPTY);
    }
    await OrbService.clearPendingCapturePath();

    if (durationMs < 500) {
      return err(EkweError.TOO_SHORT);
    }

    const peakAmp = status?.lastPeakAmplitude ?? 0.5;
    const averageDb =
      peakAmp > 0 ? 20 * Math.log10(Math.max(peakAmp, 0.0001)) : -30;

    const transcribeRes = await transcribeAudio(
      {
        uri: session.outputPath,
        durationMs,
        averageDb,
        meteringData: [],
        waveform: [],
      },
      requestedSourceLang,
      undefined,
      undefined,
      { origin: "orb" },
    );

    if (!transcribeRes.ok) {
      return err(transcribeRes.error);
    }

    const tx: TranscriptionResult = transcribeRes.value;
    const resolvedSourceLang = tx.sourceLang || requestedSourceLang;

    let translation: string | null = null;
    let mtProvider: string | null = null;
    const shouldTranslate =
      targetLang &&
      targetLang !== "auto" &&
      resolvedSourceLang !== "auto" &&
      targetLang !== resolvedSourceLang;
    if (shouldTranslate) {
      try {
        const tr = await translateText(
          tx.transcript,
          resolvedSourceLang,
          targetLang,
        );
        if (tr.ok) {
          translation = tr.value.translation || null;
          mtProvider = tr.value.provider || null;
        }
      } catch (e) {
        logger.warn("[OrbService] batch translation failed:", e);
      }
    }

    let historyId: string | undefined;
    if (options?.sessionUser?.user) {
      const payload: HistoryEntryPayload = {
        captureId: session.captureId,
        origin: "orb",
        input: "audio",
        sourceLang: resolvedSourceLang,
        targetLang,
        transcript: tx.transcript,
        translation,
        transliteration: null,
        duration: durationSeconds,
        sourceApp,
        voiceId: null,
        sttProvider: tx.provider || "groq",
        mtProvider,
        type: "transcription",
      };

      try {
        historyId = await HistoryService.recordTranslation(
          payload,
          options.sessionUser,
        );
      } catch (e) {
        logger.warn("[OrbService] Failed to record history entry:", e);
      }
    }

    return ok({
      transcript: tx.transcript,
      translation,
      sourceLang: resolvedSourceLang,
      targetLang,
      historyId,
    });
  },
};
