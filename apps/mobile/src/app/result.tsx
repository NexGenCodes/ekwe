import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect } from "react";
import { StyleSheet } from "react-native";

import { HistoryEntryDetail } from "@/components/history/HistoryEntryDetail";
import { ResultProcessingIndicator } from "@/components/result";
import { Box, Pressable } from "@/components/ui";
import { borderRadius } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useResultPipeline, useTheme } from "@/hooks";
import { SyncService } from "@/services/SyncService";
import { auth$, history$, HistoryEntry } from "@/store";
import { triggerHaptic } from "@/utils/haptics";
import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";
import { useSelector } from "@legendapp/state/react";

export default function ResultScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams();

  const entryId = params.entryId as string | undefined;

  const {
    transcript,
    translation,
    sourceLang,
    targetLang,
    isProcessing,
    isTranslating,
    isHistoryReplay,
    handleTranslate,
  } = useResultPipeline({
    uri: params.uri as string | undefined,
    entryId,
    initialTranscript: params.transcript as string | undefined,
    initialSourceLang: params.sourceLang as string | undefined,
    initialTargetLang: params.targetLang as string | undefined,
    isHistoryReplay: params.isHistoryReplay === "true",
    sourceApp: params.sourceApp as string | undefined,
  });

  const entry = useSelector(() =>
    entryId ? (history$[entryId].get() as HistoryEntry | null) : null,
  );

  const { color } = useTheme();

  const handleDeleteEntry = useCallback(async (): Promise<void> => {
    if (!entryId) return;
    const userId = auth$.user.get()?.id;
    if (!userId) return;
    const entryToDelete = history$[entryId].get();
    if (!entryToDelete) return;

    triggerHaptic(Haptics.NotificationFeedbackType.Warning);
    await SyncService.deleteHistory(entryId, userId);

    AppToast.success("Entry deleted", {
      haptics: false,
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          SyncService.restoreHistory(entryToDelete, userId).catch((err) =>
            logger.error("[result] Undo restore failed", err),
          );
        },
      },
    });

    router.back();
  }, [entryId, router]);

  useEffect(() => {
    if (
      transcript &&
      !translation &&
      !isTranslating &&
      !isProcessing &&
      !isHistoryReplay
    ) {
      handleTranslate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isHistoryReplay]);

  // Fall back to the routed params if the store entry is unavailable (e.g.
  // the entry was deleted while the sheet was open).
  const detailEntry: HistoryEntry | null = entry ?? {
    id: entryId ?? "",
    sourceLang,
    targetLang,
    transcript,
    translation,
    transliteration: null,
    timestamp: 0,
    duration: Number(params.duration ?? 0),
    sourceApp: null,
  };

  const showDetail =
    detailEntry.transcript.length > 0 || detailEntry.translation;

  return (
    <Box style={[styles.overlay, { backgroundColor: color.overlay }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => router.back()}
      />
      <Box
        style={[styles.sheetContainer, { backgroundColor: color.background }]}
      >
        <Box style={styles.header}>
          <Box style={styles.grabberContainer}>
            <Box style={[styles.grabber, { backgroundColor: color.border }]} />
          </Box>
          <Pressable
            onPress={() => router.back()}
            style={styles.closeButton}
            hitSlop={spacing.md}
          >
            <X size={24} color={color.muted} />
          </Pressable>
        </Box>

        {isProcessing && !transcript ? (
          <ResultProcessingIndicator />
        ) : showDetail ? (
          <HistoryEntryDetail
            entry={detailEntry}
            onDelete={handleDeleteEntry}
          />
        ) : (
          <Box style={styles.emptyBody} />
        )}
      </Box>
    </Box>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetContainer: {
    borderTopLeftRadius: borderRadius["2xl"],
    borderTopRightRadius: borderRadius["2xl"],
    height: "60%",
  },
  header: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  grabberContainer: {
    paddingVertical: spacing.md,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: borderRadius.sm,
  },
  closeButton: {
    position: "absolute",
    right: spacing.lg,
    top: spacing.sm,
    padding: spacing.xs,
  },
  emptyBody: {
    flex: 1,
  },
});
