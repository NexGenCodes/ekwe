import X from "lucide-react-native/icons/x";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { LanguageSwitcher } from "@/components/home/LanguageSwitcher";
import { Sheet } from "@/components/ui/Sheet";
import { Box, Pressable, Text } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { EkweError } from "@/constants/errors";
import { getLanguageName } from "@/constants/languages";
import { useReduceMotion, useTheme } from "@/hooks";
import { useValue } from "@legendapp/state/react";
import { CopyService } from "@/services/copyOutService";
import { OrbService, type OrbSession } from "@/services/orbService";
import { translateText } from "@/services/translateText";
import { auth$, settings$, settingsActions } from "@/store";
import { AppToast } from "@/utils/toast";
import { triggerHaptic } from "@/utils/haptics";

const POLL_MS = 500;
const WAVE_MS = 150;
const BAR_COUNT = 7;

function friendlyStopError(
  error: EkweError,
  streamError?: string | null,
): string {
  if (streamError && streamError.trim()) {
    return streamError;
  }
  if (error === EkweError.AUDIO_EMPTY || error === EkweError.EMPTY_TRANSCRIPT) {
    return "No capturable audio was transcribed. Some apps block playback capture — try another app and make sure audio is playing.";
  }
  if (error === EkweError.TOO_SHORT) {
    return "Too short to transcribe. Let the audio play a bit longer, then try again.";
  }
  if (error === EkweError.PREMIUM_REQUIRED) {
    return "Orb is a Premium feature. Sign in with Premium to continue.";
  }
  if (
    error === EkweError.NETWORK_LOST ||
    error === EkweError.TRANSCRIBE_TIMEOUT ||
    error === EkweError.SPEECH_TIMEOUT
  ) {
    return "Connection lost or timed out. Check your internet and try again.";
  }
  if (error === EkweError.QUOTA_EXCEEDED || error === EkweError.RATE_LIMITED) {
    return "You’ve hit a usage limit. Please wait a moment or check your plan.";
  }
  return "Couldn’t transcribe that audio. Please try again.";
}

export const OrbPanel = (): React.ReactElement => {
  const { color } = useTheme();
  const reduceMotion = useReduceMotion();
  const sourceLang = useValue(settings$.orbSourceLang);
  const targetLang = useValue(settings$.orbTargetLang);

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [detected, setDetected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<string>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [silenceSuspected, setSilenceSuspected] = useState(false);

  const sessionRef = useRef<OrbSession | null>(null);
  const startedAtRef = useRef<number>(0);
  const streamErrorRef = useRef<string | null>(null);

  useEffect(() => {
    streamErrorRef.current = streamError;
  }, [streamError]);

  const close = useCallback((): void => {
    if (running && !finishing) {
      AppToast.info("Orb keeps listening", {
        description: "Tap the Orb bubble to return to your transcript.",
      });
    }
    void OrbService.stopNative();
  }, [running, finishing]);

  useEffect(() => {
    void OrbService.dismissLoader();
    void (async (): Promise<void> => {
      const status = await OrbService.getStatus();
      if (!status) return;
      if (status.resultText) setResult(status.resultText);
      if (status.detectedLang?.trim()) setDetected(status.detectedLang.trim());
      if (status.streamState) setStreamState(status.streamState);
      if (status.streamError) setStreamError(status.streamError);
      if (typeof status.silenceSuspected === "boolean") {
        setSilenceSuspected(status.silenceSuspected);
      }
      if (status.running) {
        const startTime =
          status.startedAt && status.startedAt > 0
            ? status.startedAt
            : Date.now();
        sessionRef.current = {
          captureId: "orb_active",
          outputPath: status.outputPath ?? "",
          startTime,
          live: !!status.streaming || !!status.liveText || !!status.liveFinal,
        };
        startedAtRef.current = startTime;
        setRunning(true);
        const final = (status.liveFinal ?? "").trim();
        const partial = (status.liveInterim ?? "").trim();
        const combined = (status.liveText ?? status.resultText ?? "").trim();
        if (final || combined) setLiveText(final || combined);
        if (partial) setInterim(partial);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      const status = await OrbService.getStatus();
      if (cancelled || !status) return;
      setRunning(status.running);
      setLevel(status.lastPeakAmplitude ?? 0);
      if (status.streamState) setStreamState(status.streamState);
      if (typeof status.silenceSuspected === "boolean") {
        setSilenceSuspected(status.silenceSuspected);
      }
      if (status.streamError) setStreamError(status.streamError);
      if (status.detectedLang?.trim()) {
        setDetected(status.detectedLang.trim());
      }
      if (status.streaming || status.running) {
        const final = (status.liveFinal ?? "").trim();
        const partial = (status.liveInterim ?? "").trim();
        const combined = (status.liveText ?? status.resultText ?? "").trim();
        if (final || combined) setLiveText(final || combined);
        setInterim(partial);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), running ? WAVE_MS : POLL_MS);
    return (): void => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    if (startedAtRef.current <= 0) startedAtRef.current = Date.now();
    const tick = (): void => {
      setElapsed(
        Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)),
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  const handleStart = useCallback(async (): Promise<void> => {
    if (busy || running) return;
    await triggerHaptic();
    setError(null);
    setStreamError(null);
    setSilenceSuspected(false);
    setResult(null);
    setLiveText("");
    setInterim("");
    setDetected(null);
    if (!auth$.session.peek() || !auth$.isPro.peek()) {
      setError("Sign in with Premium to use Orb.");
      close();
      return;
    }
    setBusy(true);
    try {
      setStreamState("connecting");
      const started = await OrbService.startCapture({
        isLive: true,
        sourceLang,
      });
      if (!started.ok) {
        setStreamState("error");
        setError("Could not start Orb. Check permissions and try again.");
        return;
      }
      sessionRef.current = started.value;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRunning(true);
    } finally {
      setBusy(false);
    }
  }, [busy, running, close, sourceLang]);

  const handleStop = useCallback(async (): Promise<void> => {
    if (busy) return;
    await triggerHaptic();
    setBusy(true);
    setFinishing(true);
    setError(null);
    try {
      let session = sessionRef.current;
      if (!session) {
        const status = await OrbService.getStatus();
        if (status?.running && status.outputPath) {
          session = {
            captureId: "orb_active",
            outputPath: status.outputPath,
            startTime:
              status.startedAt && status.startedAt > 0
                ? status.startedAt
                : Date.now(),
            live: !!status.streaming || !!status.liveText || !!status.liveFinal,
          };
        }
      }
      sessionRef.current = null;
      startedAtRef.current = 0;
      setRunning(false);

      if (!session) {
        const rawPath = await OrbService.readPendingCapturePath();
        if (rawPath) {
          await OrbService.clearPendingCapturePath();
          const start = Date.now() - 3000;
          session = {
            captureId: "orb_pending",
            outputPath: rawPath.startsWith("file://")
              ? rawPath
              : `file://${rawPath}`,
            startTime: start,
          };
        } else {
          return;
        }
      }

      const res = await OrbService.stopCapture(session, {
        sourceLang,
        targetLang,
      });
      if (!res.ok) {
        setError(friendlyStopError(res.error, streamErrorRef.current));
        await OrbService.setBubbleText("error");
        return;
      }

      const detectedLang = res.value.sourceLang;
      if (detectedLang && detectedLang !== "auto") setDetected(detectedLang);

      let shown = res.value.translation || res.value.transcript;
      const effectiveSource = detectedLang || sourceLang || "auto";
      if (!res.value.translation && targetLang && targetLang !== "auto") {
        if (effectiveSource !== "auto" && targetLang !== effectiveSource) {
          const translated = await translateText(
            res.value.transcript,
            effectiveSource,
            targetLang,
          );
          if (translated.ok) shown = translated.value.translation || shown;
        }
      }

      setResult(shown);
      setLiveText("");
      setInterim("");
      setStreamState("idle");
      setStreamError(null);
      setSilenceSuspected(false);
      await OrbService.setBubbleText("✓");
      await OrbService.setResultText(shown);
    } finally {
      setBusy(false);
      setFinishing(false);
    }
  }, [busy, sourceLang, targetLang]);

  useEffect(() => {
    if (!running && sessionRef.current && !busy) {
      void handleStop();
    }
  }, [running, busy, handleStop]);

  const handleSourceChange = useCallback((code: string): void => {
    settingsActions.setOrbSourceLang(code);
    setDetected(null);
  }, []);

  const handleTargetChange = useCallback((code: string): void => {
    settingsActions.setOrbTargetLang(code);
  }, []);

  const handleSwap = useCallback(async (): Promise<void> => {
    const eff = sourceLang === "auto" ? detected : sourceLang;
    if (!eff || targetLang === "auto" || eff === targetLang || !targetLang)
      return;
    await triggerHaptic();
    settingsActions.setOrbSourceLang(targetLang);
    settingsActions.setOrbTargetLang(eff);
    setDetected(null);
  }, [sourceLang, targetLang, detected]);

  const handleCopy = useCallback(
    async (text?: string | null): Promise<void> => {
      const value = text ?? result;
      if (!value) return;
      const ok = await CopyService.copyText(value, { sign: true });
      if (ok) AppToast.success("Copied");
    },
    [result],
  );

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const effectiveStreamError =
    streamError ||
    (streamState === "error" ? "Live transcription was interrupted." : null);

  const statusLabel = useMemo(() => {
    if (finishing) return "FINISHING";
    if (effectiveStreamError && running) return "ERROR";
    if (running && streamState === "connecting") return "CONNECTING";
    if (running) return "RECORDING";
    if (effectiveStreamError) return "ERROR";
    return "READY";
  }, [finishing, effectiveStreamError, running, streamState]);

  const statusLine = useMemo(() => {
    if (finishing) return "Finishing transcript…";
    if (running) {
      if (effectiveStreamError)
        return "Live transcription issue — you can stop to keep what was captured.";
      if (streamState === "connecting")
        return "Connecting to live transcription…";
      if (silenceSuspected && !liveText && !interim) {
        return "No capturable audio detected yet. Some apps block playback capture.";
      }
      if (liveText || interim) return "Hearing audio…";
      return "Listening — play audio in another app.";
    }
    return "Tap Start, then play audio in another app.";
  }, [
    finishing,
    running,
    effectiveStreamError,
    streamState,
    silenceSuspected,
    liveText,
    interim,
  ]);

  const badgeBg = running
    ? color.error
    : effectiveStreamError
      ? color.error
      : color.surface;
  const badgeFg =
    running || effectiveStreamError ? color.onBrand : color.foreground;

  return (
    <Sheet visible onClose={close} maxHeight="78%">
      <Box
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing["2xl"],
        }}
      >
        <Box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: spacing.lg,
            marginTop: spacing.sm,
          }}
        >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Box
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                borderRadius: borderRadius.full,
                backgroundColor: badgeBg,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
              }}
            >
              <Box
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: badgeFg,
                  opacity: finishing || streamState === "connecting" ? 0.7 : 1,
                }}
              />
              <Text
                variant="caption"
                style={{ color: badgeFg, fontWeight: "700" }}
              >
                {statusLabel}
              </Text>
            </Box>
            <Text variant="heading3" style={{ color: color.foreground }}>
              Orb
            </Text>
          </Box>
          <Pressable
            onPress={close}
            accessibilityLabel="Close Orb"
            accessibilityRole="button"
            hitSlop={12}
            style={({ pressed }) => [
              {
                width: 44,
                height: 44,
                borderRadius: borderRadius.full,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: color.surface,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <X size={20} color={color.foreground} />
          </Pressable>
        </Box>

        <Text
          variant="bodySmall"
          style={{ color: color.muted, marginBottom: spacing.md }}
        >
          Transcribes audio playing in other apps (screen audio, not your
          microphone). Closing keeps capture running — tap the bubble to return.
        </Text>

        <LanguageSwitcher
          sourceLang={sourceLang}
          targetLang={targetLang}
          detectedLanguage={detected}
          onSwap={() => void handleSwap()}
          onSourceChange={handleSourceChange}
          onTargetChange={handleTargetChange}
        />

        <Box
          accessible
          accessibilityLabel={
            running ? `Recording ${mm}:${ss}` : "Ready to record"
          }
          accessibilityRole="text"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            marginTop: spacing.lg,
            padding: spacing.md,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: borderRadius["2xl"],
            backgroundColor: color.card,
          }}
        >
          <Box
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 2,
              height: 22,
            }}
            accessible={false}
          >
            {Array.from({ length: BAR_COUNT }).map((_, i) => {
              const phase = reduceMotion
                ? 0
                : (Date.now() / 140 + i * 0.65) % (Math.PI * 2);
              const base = running ? 0.15 : 0.05;
              const factor = reduceMotion
                ? 0.4
                : Math.abs(Math.sin(phase)) * 0.85 + 0.15;
              const amp = running ? Math.max(base, Math.min(1, level)) : 0;
              const height = 4 + amp * 14 * factor;
              return (
                <Box
                  key={i}
                  style={{
                    width: 3,
                    height,
                    borderRadius: 2,
                    backgroundColor: running ? color.error : color.muted,
                  }}
                />
              );
            })}
          </Box>
          <Text
            variant="body"
            style={{
              color: color.foreground,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {running || finishing ? `${mm}:${ss}` : "00:00"}
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: color.muted, flex: 1 }}
            numberOfLines={2}
          >
            {statusLine}
          </Text>
        </Box>

        {effectiveStreamError && !error ? (
          <Text
            variant="bodySmall"
            accessibilityLiveRegion="polite"
            style={{ color: color.error, marginTop: spacing.md }}
          >
            {effectiveStreamError}
          </Text>
        ) : null}
        {error ? (
          <Text
            variant="bodySmall"
            accessibilityLiveRegion="polite"
            style={{ color: color.error, marginTop: spacing.md }}
          >
            {error}
          </Text>
        ) : null}

        {running && (liveText || interim) ? (
          <Box
            style={{
              marginTop: spacing.lg,
              borderWidth: 1,
              borderColor: color.brand,
              borderRadius: borderRadius["2xl"],
              padding: spacing.md,
              backgroundColor: color.background,
            }}
          >
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: spacing.sm,
              }}
            >
              <Text variant="caption" style={{ color: color.muted }}>
                Live transcript
              </Text>
              <Pressable
                onPress={() =>
                  void handleCopy(
                    [liveText.trim(), interim.trim()]
                      .filter(Boolean)
                      .join(" ")
                      .trim(),
                  )
                }
                accessibilityLabel="Copy live transcript"
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text
                  variant="caption"
                  style={{ color: color.brand, fontWeight: "600" }}
                >
                  Copy
                </Text>
              </Pressable>
            </Box>
            <Text
              variant="body"
              accessibilityLiveRegion="polite"
              style={{ color: color.foreground, lineHeight: 24 }}
            >
              {liveText}
              {interim ? (
                <Text style={{ color: color.muted }}>
                  {liveText ? " " : ""}
                  {interim}
                </Text>
              ) : null}
            </Text>
          </Box>
        ) : null}

        {result ? (
          <Box
            style={{
              marginTop: spacing.lg,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: borderRadius["2xl"],
              padding: spacing.md,
              backgroundColor: color.background,
            }}
          >
            <Text
              variant="caption"
              style={{ color: color.muted, marginBottom: spacing.sm }}
            >
              {`${getLanguageName(detected || sourceLang)} → ${getLanguageName(targetLang)}`}
            </Text>
            <Text
              selectable
              variant="body"
              style={{ color: color.foreground, lineHeight: 24 }}
              numberOfLines={6}
            >
              {result}
            </Text>
            <Box
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                marginTop: spacing.sm,
              }}
            >
              <Pressable
                onPress={() => void handleCopy()}
                accessibilityLabel="Copy result"
                accessibilityRole="button"
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  minHeight: 44,
                  justifyContent: "center",
                  borderRadius: borderRadius["2xl"],
                  borderWidth: 1,
                  borderColor: color.border,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  variant="bodySmall"
                  style={{ color: color.brand, fontWeight: "600" }}
                >
                  Copy
                </Text>
              </Pressable>
            </Box>
          </Box>
        ) : null}

        <Pressable
          onPress={() => void (running ? handleStop() : handleStart())}
          disabled={busy}
          accessibilityLabel={
            finishing ? "Finishing" : running ? "Stop Orb" : "Start Orb"
          }
          accessibilityRole="button"
          accessibilityHint={
            running
              ? "Stops capture and finishes the transcript"
              : "Starts live transcription of audio playing in other apps"
          }
          accessibilityState={{ disabled: busy, busy }}
          style={({ pressed }) => [
            {
              marginTop: spacing.lg,
              minHeight: 48,
              paddingVertical: spacing.md,
              borderRadius: borderRadius["2xl"],
              backgroundColor: running || finishing ? color.error : color.brand,
              alignItems: "center",
              justifyContent: "center",
              opacity: busy ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            variant="body"
            style={{
              color: color.onBrand,
              fontWeight: "700",
            }}
          >
            {finishing
              ? "Finishing…"
              : busy
                ? "Working…"
                : running
                  ? "Stop"
                  : "Start"}
          </Text>
        </Pressable>
      </Box>
    </Sheet>
  );
};
