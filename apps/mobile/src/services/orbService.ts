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
import logger from "@/utils/logger";
import EkweNative from "../../modules/ekwe-native";
import type {
  OrbStatus,
  SimpleResult,
} from "../../modules/ekwe-native/src/EkweNative.types";

export interface OrbSession {
  captureId: string;
  outputPath: string;
  startTime: number;
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

  configure: async (config: {
    orbEnabled?: boolean;
    orbAutoArm?: boolean;
  }): Promise<boolean> => {
    if (!isAndroid) return false;
    return (await EkweNative.configureOrb?.(config)) ?? false;
  },

  startCapture: async (options?: {
    isLive?: boolean;
  }): Promise<Result<OrbSession, EkweError>> => {
    if (!isAndroid) {
      return err(EkweError.BAD_FORMAT);
    }

    const captureId = `orb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const outputPath = `${Paths.cache.uri}ekwe_orb_${captureId}.ogg`;

    try {
      const res: SimpleResult | undefined = await EkweNative.startOrbCapture?.(
        outputPath,
        options?.isLive ?? false,
      );
      if (!res?.success) {
        logger.error("[OrbService] startOrbCapture failed:", res?.error);
        return err(EkweError.AUDIO_RECORD_FAIL);
      }
      return ok({
        captureId,
        outputPath,
        startTime: Date.now(),
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
  ): Promise<Result<{ transcript: string; historyId?: string }, EkweError>> => {
    if (!isAndroid) {
      return err(EkweError.BAD_FORMAT);
    }

    try {
      await EkweNative.stopOrbCapture?.();
    } catch (e) {
      logger.warn("[OrbService] stopOrbCapture call failed:", e);
    }

    const file = new ExpoFile(session.outputPath);
    if (!file.exists || file.size === 0) {
      return err(EkweError.AUDIO_EMPTY);
    }

    const durationMs = Date.now() - session.startTime;
    if (durationMs < 500) {
      return err(EkweError.TOO_SHORT);
    }
    const durationSeconds = Math.max(1, Math.round(durationMs / 1000));

    const status = await EkweNative.getOrbStatus?.();
    const sourceApp = status?.foregroundApp ?? null;

    const sourceLang = options?.sourceLang ?? "auto";
    const targetLang = options?.targetLang ?? "en";

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
      sourceLang,
    );

    if (!transcribeRes.ok) {
      return err(transcribeRes.error);
    }

    const tx: TranscriptionResult = transcribeRes.value;
    let historyId: string | undefined;

    if (options?.sessionUser?.user) {
      const payload: HistoryEntryPayload = {
        captureId: session.captureId,
        origin: "orb",
        input: "audio",
        sourceLang: tx.sourceLang || sourceLang,
        targetLang,
        transcript: tx.transcript,
        translation: null,
        transliteration: null,
        duration: durationSeconds,
        sourceApp,
        voiceId: null,
        sttProvider: tx.provider || "groq",
        mtProvider: null,
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
      historyId,
    });
  },
};
