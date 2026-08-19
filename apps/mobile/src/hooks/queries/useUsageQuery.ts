import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSelector } from "@legendapp/state/react";

import { auth$ } from "@/store";
import { fetchUsage, type UsageSnapshot } from "@/services/usage";
import { queryClient } from "./queryClient";

const usageQueryKey = ["usage"] as const;

/**
 * Marks the cached usage snapshot stale so the next visible meter refetches.
 * Called after a billable translate/transcribe completes (or fails with 429).
 */
export function invalidateUsage(): void {
  void queryClient.invalidateQueries({ queryKey: usageQueryKey });
}

export function useUsageQuery(): UseQueryResult<UsageSnapshot> {
  const isPro = useSelector(() => auth$.isPro.get());

  return useQuery<UsageSnapshot>({
    queryKey: usageQueryKey,
    queryFn: async () => {
      const result = await fetchUsage();
      if (!result.ok) throw new Error(result.error);
      return result.value;
    },
    enabled: true,
    staleTime: 60 * 1000,
    // Background refresh on reconnect is already handled by the global
    // onlineManager; keep the local staleness short so the meter stays honest
    // after the user translates.
    refetchOnMount: isPro ? "always" : true,
    retry: false,
  });
}
