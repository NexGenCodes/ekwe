import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/services/supabase";
import { planConfig$, planConfigActions } from "@/store/planConfig";
import type { PlanConfigResponse } from "@/store/planConfig";
import { fetchWithRetry } from "@/utils/networkUtils";

async function fetchPlanConfig(): Promise<PlanConfigResponse> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    throw new Error("Not authenticated");
  }

  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL ?? "";
  if (!workerUrl) {
    throw new Error("Worker URL not configured");
  }

  const response = await fetchWithRetry(`${workerUrl}/plan`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    retries: 2,
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  return response.json() as Promise<PlanConfigResponse>;
}

export function usePlanConfigQuery() {
  const query = useQuery({
    queryKey: ["plan"],
    queryFn: fetchPlanConfig,
    staleTime: 5 * 60 * 1000,
    initialData: () => planConfig$.config.get() ?? undefined,
  });

  useEffect(() => {
    if (query.data && query.isSuccess) {
      planConfigActions.setConfig(query.data);
    }
  }, [query.data, query.isSuccess]);

  return query;
}
