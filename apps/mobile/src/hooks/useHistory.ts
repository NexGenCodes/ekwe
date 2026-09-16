import { useSelector } from "@legendapp/state/react";
import { useCallback } from "react";

import { useHistoryQuery } from "@/hooks/queries/useHistoryQuery";
import { SyncService } from "@/services/SyncService";
import { HistoryEntry, history$, sortedHistory$, auth$ } from "@/store";
import logger from "@/utils/logger";
import { AppToast } from "@/utils/toast";

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  deleteEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  refetch: () => Promise<void>;
}

export const useHistory = (): UseHistoryReturn => {
  const entries = useSelector(() => sortedHistory$.get());
  const userId = useSelector(() => auth$.user.get()?.id);
  const { loadMore, hasMore, isFetchingNextPage, refetch } =
    useHistoryQuery(userId);

  const deleteEntry = useCallback(
    async (id: string): Promise<void> => {
      if (!userId) {
        logger.warn("[useHistory] Cannot delete entry: no authenticated user");
        return;
      }
      const entry = history$[id].get();
      if (!entry) return;

      await SyncService.deleteHistory(id, userId);

      AppToast.success("Entry deleted", {
        haptics: false,
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            SyncService.restoreHistory(entry, userId).catch((err) =>
              logger.error("[useHistory] Undo restore failed", err),
            );
          },
        },
      });
    },
    [userId],
  );

  const clearAll = useCallback(async (): Promise<void> => {
    if (!userId) {
      logger.warn("[useHistory] Cannot clear entries: no authenticated user");
      return;
    }
    await SyncService.clearAllHistory(userId);
  }, [userId]);

  return {
    entries,
    deleteEntry,
    clearAll,
    loadMore,
    hasMore,
    isFetchingNextPage,
    refetch,
  };
};
