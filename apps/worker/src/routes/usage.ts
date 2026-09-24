import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env, Tier } from "@/core/types";
import { fetchUsageSnapshot } from "@/services/usage";

export async function handleUsage(
  env: Env,
  userId: string,
  tier: Tier,
): Promise<Response> {
  const snapshot = await fetchUsageSnapshot(env, userId, tier);
  if (!snapshot) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.USAGE_UNAVAILABLE,
        message: "Usage data is unavailable.",
      },
      { status: 503 },
    );
  }
  return Response.json(snapshot);
}
