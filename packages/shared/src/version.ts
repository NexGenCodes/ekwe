/** Single source of truth for the Ekwe app version. */
export const APP_VERSION = "1.2.8" as const;

/**
 * Numeric version code derived from the semver string.
 * Formula: MAJOR * 10000 + MINOR * 100 + PATCH
 * Must stay < 1_000_000 (each segment < 100).
 */
export const APP_VERSION_CODE = 10208 as const;
