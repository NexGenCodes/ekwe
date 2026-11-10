import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useValue } from "@legendapp/state/react";

import { OrbService } from "@/services/orbService";
import { translateText } from "@/services/translateText";
import { EkweError } from "@/constants/errors";
import { auth$, settings$ } from "@/store";
import { AppToast } from "@/utils/toast";
import EkweNative from "../../modules/ekwe-native";

let transcribing = false;

async function syncGatedConfig(): Promise<void> {
  const state = settings$.get();
  const langs =
    state.selectedLanguages.length > 0 ? state.selectedLanguages : ["en"];
  const allowed = auth$.isPro.peek() && auth$.session.peek() !== null;
  await OrbService.configure({
    orbEnabled: allowed ? state.orbEnabled : false,
    myLanguages: langs,
    sourceLang: state.orbSourceLang,
    targetLang: state.orbTargetLang,
  });
}

async function syncLanguagesFromNative(): Promise<void> {
  const status = await OrbService.getStatus();
  if (!status) return;
  if (
    status.sourceLang &&
    status.sourceLang !== settings$.orbSourceLang.peek()
  ) {
    settings$.orbSourceLang.set(status.sourceLang);
  }
  if (
    status.targetLang &&
    status.targetLang !== settings$.orbTargetLang.peek()
  ) {
    settings$.orbTargetLang.set(status.targetLang);
  }
}

async function transcribePending(): Promise<void> {
  if (!auth$.isPro.peek() || !auth$.session.peek()) {
    await OrbService.clearPendingCapturePath();
    await OrbService.stopNative();
    return;
  }
  if (transcribing) return;
  const rawPath = await OrbService.readPendingCapturePath();
  if (!rawPath) return;
  const status = await OrbService.getStatus();
  if (status?.running) return;
  transcribing = true;
  try {
    await OrbService.clearPendingCapturePath();
    const fileUri = rawPath.startsWith("file://")
      ? rawPath
      : `file://${rawPath}`;
    let durationMs = 0;
    try {
      durationMs = (await EkweNative.probeAudioDurationMs(rawPath)) ?? 0;
    } catch {
      durationMs = 0;
    }
    if (durationMs <= 0) durationMs = 3000;
    const sourceLang = settings$.orbSourceLang.peek();
    const targetLang = settings$.orbTargetLang.peek();
    const res = await OrbService.stopCapture(
      {
        captureId: `orb_${Date.now()}`,
        outputPath: fileUri,
        startTime: Date.now() - durationMs,
      },
      {
        sourceLang,
        targetLang,
        sessionUser: auth$.session.peek(),
      },
    );
    if (res.ok) {
      const effectiveSource = res.value.sourceLang || sourceLang || "auto";
      let resultText = res.value.translation || res.value.transcript;
      if (!res.value.translation && targetLang && targetLang !== "auto") {
        if (effectiveSource !== "auto" && targetLang !== effectiveSource) {
          const fetched = await translateText(
            res.value.transcript,
            effectiveSource,
            targetLang,
          );
          if (fetched.ok) resultText = fetched.value.translation || resultText;
        }
      }
      await OrbService.setBubbleText("✓");
      await OrbService.setResultText(resultText);
      AppToast.success("Transcribed", {
        description: "Saved to history.",
      });
    } else if (
      res.error === EkweError.AUDIO_EMPTY ||
      res.error === EkweError.EMPTY_TRANSCRIPT ||
      res.error === EkweError.TOO_SHORT
    ) {
      await OrbService.setBubbleText("error");
      AppToast.info("No capturable audio transcribed", {
        description: "Some apps block playback capture. Try another app.",
      });
    } else if (
      res.error === EkweError.NETWORK_LOST ||
      res.error === EkweError.TRANSCRIBE_TIMEOUT ||
      res.error === EkweError.SPEECH_TIMEOUT
    ) {
      await OrbService.setBubbleText("error");
      AppToast.error("Connection issue", {
        description: "Check your internet and try again.",
      });
    } else {
      await OrbService.setBubbleText("error");
      AppToast.error("Transcription failed", {
        description: "Try again from Orb.",
      });
    }
  } finally {
    transcribing = false;
  }
}

export function useOrbController(): void {
  const isAuthenticated = useValue(() => auth$.session.get() !== null);
  const isPro = useValue(() => auth$.isPro.get());
  const orbEnabled = useValue(() => settings$.orbEnabled.get());
  const foreground = useRef(true);

  useEffect(() => {
    void syncGatedConfig();
  }, [isAuthenticated, isPro, orbEnabled]);

  useEffect(() => {
    if (!isPro || !isAuthenticated) {
      void OrbService.stopNative();
      return;
    }
    let cancelled = false;

    const onForeground = async (): Promise<void> => {
      if (cancelled) return;
      await syncLanguagesFromNative();
      if (cancelled) return;
      await transcribePending();
    };

    void onForeground();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !foreground.current) {
        foreground.current = true;
        void onForeground();
      } else if (state !== "active") {
        foreground.current = false;
      }
    });
    return (): void => {
      cancelled = true;
      sub.remove();
    };
  }, [isAuthenticated, isPro]);
}
