#!/usr/bin/env bash
#
# Clean stale native build caches so Expo module autolinking output is rebuilt
# from scratch. Prevents the recurring runtime crash where Gradle treats
# outdated compiled artifacts inside node_modules as up-to-date and the App
# fails at launch with `ClassNotFoundException: expo.modules.ExpoModulesPackageList`.
#
# Usage:
#   scripts/clean-native.sh            # android + ios
#   scripts/clean-native.sh --android  # android only
#   scripts/clean-native.sh --ios      # ios only
#
# From apps/mobile: `pnpm clean:native` / `pnpm clean:android` / `pnpm clean:ios`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
DO_ANDROID=1
DO_IOS=1

for arg in "$@"; do
  case "$arg" in
    --android) DO_IOS=0 ;;
    --ios) DO_ANDROID=0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# Wipe stale gradle module caches under the pnpm store. These are compiled
# outputs that Gradle marks as up-to-date even when the generated sources
# (e.g. ExpoModulesPackageList.kt) changed underneath them.
echo "==> Wiping stale module build caches under node_modules"
shopt -s nullglob
for dir in "$ROOT"/node_modules/.pnpm/*/node_modules/expo*/android/build \
           "$ROOT"/node_modules/.pnpm/*/node_modules/@expo/*/android/build; do
  echo "    rm -rf $dir"
  rm -rf "$dir"
done

if [ "$DO_ANDROID" = "1" ]; then
  echo "==> Cleaning Android project"
  rm -rf "$MOBILE/android/app/build"
  if [ -d "$MOBILE/android" ]; then
    (cd "$MOBILE/android" && ./gradlew --stop >/dev/null 2>&1 || true)
    (cd "$MOBILE/android" && ./gradlew clean >/dev/null 2>&1 || true)
  fi
fi

if [ "$DO_IOS" = "1" ]; then
  echo "==> Cleaning iOS project"
  rm -rf "$MOBILE/ios/build" "$MOBILE/ios/Pods"
  rm -rf "$MOBILE"/ios/*/build 2>/dev/null || true
fi

echo "Done. Rebuild with \`pnpm android\` or \`pnpm ios\`."