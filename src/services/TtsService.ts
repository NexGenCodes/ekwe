import * as Speech from "expo-speech";

import { EkweError } from "@/constants/errors";
import { ok, err, type Result } from "@/types/Result";
import logger from "@/utils/logger";

type TtsState = "idle" | "speaking" | "paused" | "loading";

interface SpeakCallbacks {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: string) => void;
  onStopped?: () => void;
}

class TtsServiceClass {
  private state: TtsState = "idle";
  private generation = 0;

  get isSpeaking(): boolean {
    return this.state === "speaking";
  }

  get isPaused(): boolean {
    return this.state === "paused";
  }

  get isLoading(): boolean {
    return this.state === "loading";
  }

  async speak(
    text: string,
    language: string,
    callbacks?: SpeakCallbacks,
  ): Promise<Result<void, EkweError>> {
    if (!text.trim()) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

    const gen = ++this.generation;
    this.state = "loading";

    try {
      await Speech.stop();
    } catch {
      // ignore stop errors before new speech
    }

    if (gen !== this.generation) {
      this.state = "idle";
      return err(EkweError.TTS_FAIL);
    }

    try {
      logger.info("[TtsService] Speaking", {
        language,
        length: text.length,
      });

      Speech.speak(text, {
        language,
        onStart: () => {
          if (gen !== this.generation) return;
          this.state = "speaking";
          callbacks?.onStart?.();
        },
        onDone: () => {
          if (gen !== this.generation) return;
          this.state = "idle";
          callbacks?.onDone?.();
        },
        onError: (e) => {
          if (gen !== this.generation) return;
          const errorMsg = e instanceof Error ? e.message : String(e);

          if (
            errorMsg.toLowerCase().includes("interrupted") ||
            errorMsg.toLowerCase().includes("stopped")
          ) {
            this.state = "idle";
            callbacks?.onStopped?.();
            return;
          }

          logger.error("[TtsService] Speak error:", errorMsg);
          this.state = "idle";
          callbacks?.onError?.(errorMsg);
        },
        onStopped: () => {
          if (gen !== this.generation) return;
          this.state = "idle";
          callbacks?.onStopped?.();
        },
      });

      return ok(undefined);
    } catch (e) {
      if (gen !== this.generation) return err(EkweError.TTS_FAIL);
      const errorMsg = e instanceof Error ? e.message : String(e);
      logger.error("[TtsService] speak() threw:", errorMsg);
      this.state = "idle";
      return err(EkweError.TTS_FAIL);
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    try {
      await Speech.stop();
    } catch (err) {
      logger.warn("[TtsService] stop() threw:", err);
    }
    this.state = "idle";
  }

  async pause(): Promise<void> {
    try {
      await Speech.pause();
      this.state = "paused";
    } catch (e) {
      logger.warn("[TtsService] pause() threw:", e);
    }
  }

  async resume(): Promise<void> {
    try {
      await Speech.resume();
      this.state = "speaking";
    } catch (e) {
      logger.warn("[TtsService] resume() threw:", e);
    }
  }

  destroy(): void {
    this.generation++;
    Speech.stop();
    this.state = "idle";
    logger.info("[TtsService] Destroyed");
  }
}

export const TtsService = new TtsServiceClass();
