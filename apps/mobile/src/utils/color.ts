/**
 * Appends a hex alpha channel to a #RRGGBB color string (e.g. `#006FEE` +
 * 0.15 → `#006FEE26`). Use this instead of ad-hoc `"${color}14"` string
 * suffixes so tints stay consistent and readable.
 */
export const withAlpha = (hex: string, alpha: number): string => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${a.toString(16).padStart(2, "0")}`;
};