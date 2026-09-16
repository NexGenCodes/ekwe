export const shadows = {
  soft: "0 2px 12px rgba(9, 9, 11, 0.03)",
  softLg: "0 4px 16px rgba(9, 9, 11, 0.05)",
} as const;

export type ShadowKey = keyof typeof shadows;
