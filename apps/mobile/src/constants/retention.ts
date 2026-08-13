/**
 * Retention policy for history rows, in days.
 *
 * These numbers were previously hardcoded in three places that disagreed with
 * each other: the DB cleanup ran at 7 days while the permissions hook reported
 * 90, and cloud retention (30/365) lived in @ekwe/shared/plans. Centralizing
 * the local TTL here keeps cleanup behavior and what the app reports in sync.
 *
 * Cloud retention (historyRemoteTtlDays) is plan-based and lives in
 * @ekwe/shared/plans — do not duplicate it here.
 */
export const HISTORY_LOCAL_TTL_DAYS = 7;
