export const SYNC_PULL_ROWS = 200;
export const SYNC_PUSH_ROWS_FREE = 25;
export const SYNC_PUSH_ROWS_PAID = 200;
export const MAX_HISTORY_BATCH_BYTES = 90 * 1024;

/** Pushes are write-heavy, so they get their own short window. */
export const SYNC_PUSH_COOLDOWN_MS = 250;

export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const OTP_EXPIRY_SECONDS = 300;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 5;

export function syncPushRows(workersPaid: boolean): number {
  return workersPaid ? SYNC_PUSH_ROWS_PAID : SYNC_PUSH_ROWS_FREE;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `YYYY-MM` in UTC, the key for the shared monthly AI pool. */
export function utcMonth(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** First instant of the next UTC month, used for quota reset copy. */
export function nextUtcMonthStartMs(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}
