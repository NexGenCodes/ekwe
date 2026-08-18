import type { Href, ImperativeRouter } from "expo-router";

const lastPushAt = new Map<string, number>();
const PUSH_COOLDOWN_MS = 600;

export function pushOnce(router: ImperativeRouter, href: Href): void {
  const key = typeof href === "string" ? href : JSON.stringify(href);
  const now = Date.now();
  const last = lastPushAt.get(key) ?? 0;
  if (now - last < PUSH_COOLDOWN_MS) {
    return;
  }
  lastPushAt.set(key, now);
  router.push(href);
}

export function resetNavigationGuard(): void {
  lastPushAt.clear();
}