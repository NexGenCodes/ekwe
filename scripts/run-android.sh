#!/usr/bin/env bash
#
# Build the Android app in a clean environment. The root cause of the
# recurring "Gradle build daemon disappeared unexpectedly" failure on
# low-memory hosts is stale Gradle daemons piling up between builds —
# each one keeps up to -Xmx worth of heap resident, and combined with
# the Kotlin/CMake/NitroModules workers this exhausts RAM and trips the
# OOM killer mid-build.
#
# This wrapper guarantees a single fresh daemon per build by stopping
# leftovers first, then delegates to `expo run:android`.
#
# Usage:
#   scripts/run-android.sh           # detect ABI from device, else arm64-v8a
#   ABI=x86_64 scripts/run-android.sh
#
# From apps/mobile: `pnpm android`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"

echo "==> Stopping stale Gradle daemons"
shopt -s nullglob
for build in "$MOBILE"/android/build.gradle \
             "$MOBILE"/android/build.gradle.kts \
             "$MOBILE"/android/settings.gradle \
             "$MOBILE"/android/settings.gradle.kts; do
  [ -e "$build" ] || continue
  (cd "$MOBILE/android" && ./gradlew --stop >/dev/null 2>&1 || true)
  break
done

ABI="${ABI:-}"
if [ -z "$ABI" ]; then
  ABI="$(adb shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || true)"
  ABI="${ABI:-arm64-v8a}"
fi
export EXPO_PUBLIC_DEV_ARCH="$ABI"

cd "$MOBILE"

EXPO_CLI="$MOBILE/node_modules/.bin/expo"
if [ ! -x "$EXPO_CLI" ]; then
  EXPO_CLI="$ROOT/node_modules/.bin/expo"
fi
if [ ! -x "$EXPO_CLI" ]; then
  EXPO_CLI="$(command -v expo || true)"
fi
if [ -z "$EXPO_CLI" ] || [ ! -x "$EXPO_CLI" ]; then
  echo "error: expo CLI not found" >&2
  exit 1
fi

exec "$EXPO_CLI" run:android