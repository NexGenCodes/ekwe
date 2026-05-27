export function resolveVariant<T extends string, R>(
  variant: T | undefined,
  config: Record<T, R>,
  defaultKey: T,
): R {
  return config[variant ?? defaultKey];
}
