import { resetUserScopedQueries } from "@/hooks/core/useSyncedQuery";
import { audio$, initialAudioState } from "@/store/audio";
import { dictation$, INITIAL_STATE } from "@/store/dictationStore";
import { history$ } from "@/store/history";
import { logger } from "@/utils";

export function resetUserScopedState(): void {
  history$.set({});
  dictation$.set({ ...INITIAL_STATE });
  audio$.set({ ...initialAudioState });
  void resetUserScopedQueries().catch((err) => {
    logger.warn("[Reset] Failed to reset cached queries", err);
  });
}
