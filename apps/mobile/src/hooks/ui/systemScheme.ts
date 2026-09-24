import { useSyncExternalStore } from "react";
import { Appearance, AppState } from "react-native";

import { isAndroid } from "@/utils/platform";
import EkweNative from "../../../modules/ekwe-native";

export type SystemScheme = "light" | "dark";

function readReactive(): SystemScheme {
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

function readNative(): SystemScheme | null {
  try {
    const native = EkweNative.getSystemTheme();
    if (native === "light" || native === "dark") return native;
  } catch {
    // Native theme unavailable — fall back to the reactive Appearance value.
  }
  return null;
}

let resolved: SystemScheme = readReactive();
let started = false;
const listeners = new Set<() => void>();

function set(next: SystemScheme): void {
  if (next === resolved) return;
  resolved = next;
  for (const listener of listeners) listener();
}

function refresh(): void {
  const native = isAndroid ? readNative() : null;
  set(native ?? readReactive());
}

function ensureStarted(): void {
  if (started) return;
  started = true;

  Appearance.addChangeListener(refresh);

  if (isAndroid) {
    AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });

    refresh();
  }
}

function subscribe(listener: () => void): () => void {
  ensureStarted();
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SystemScheme {
  return resolved;
}

export function useSystemScheme(): SystemScheme {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
