export const duration = {
  instant: 50,
  fast: 150,
  normal: 250,
  slow: 400,
  slower: 600,
} as const;

export const spring = {
  snappy: { damping: 20, stiffness: 300, mass: 0.5 },
  smooth: { damping: 15, stiffness: 200, mass: 1 },
  gentle: { damping: 10, stiffness: 100, mass: 1 },
} as const;

export const scale = {
  pressIn: 0.95,
  pulse: 1.05,
} as const;

export type DurationKey = keyof typeof duration;
export type SpringKey = keyof typeof spring;
