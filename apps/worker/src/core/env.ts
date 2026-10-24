/**
 * Returns true when the Worker is running on a Paid Cloudflare plan.
 *
 * WORKERS_PAID is a plain string env var ("true" / "false" / unset). This
 * helper centralises the cast and the case-insensitive comparison so callers
 * cannot accidentally miss it with "True" or "1".
 */
export function isWorkersPaid(env: { WORKERS_PAID?: string }): boolean {
  return env.WORKERS_PAID?.toLowerCase() === "true";
}
