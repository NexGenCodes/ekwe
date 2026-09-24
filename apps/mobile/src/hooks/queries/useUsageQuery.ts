import { createSyncedQuery } from "@/hooks/core/useSyncedQuery";
import { fetchUsage } from "@/services/usage";

const usageQuery = createSyncedQuery("usage-cache", async () => {
  const result = await fetchUsage();
  if (!result.ok) throw new Error(result.error);
  return result.value;
});

export const useUsageQuery = usageQuery.useQuery;
export const invalidateUsage = usageQuery.invalidate;
export const usage$ = usageQuery.query$;
