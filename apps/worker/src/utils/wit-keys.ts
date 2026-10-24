import type { Env } from "@/core/types";

export function getWitSecretKey(
  env: Env,
  targetLang: string,
  baseLang: string,
): string | null {
  const direct =
    (env[`WIT_KEY_${targetLang}` as keyof Env] as string | undefined) ??
    (env[`WIT_KEY_${baseLang}` as keyof Env] as string | undefined);
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return null;
}
