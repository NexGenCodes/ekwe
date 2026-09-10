#!/usr/bin/env bash
#
# Remove the generated native projects before `expo prebuild` so every run
# regenerates `android/` and `ios/` from a clean slate.
#
# Rationale: `expo prebuild` alone will not overwrite the generated
# MainApplication entry files when switching between a template that produces
# `MainApplication.java` and one that produces `MainApplication.kt`. A stale
# directory then fails with:
#   withAndroidDangerousBaseMod: Project file "MainApplication" does not exist
# Always wiping the target platform(s) first makes prebuild deterministic.
#
# Usage:
#   scripts/prebuild-clean.sh            # android + ios
#   scripts/prebuild-clean.sh android    # android only
#   scripts/prebuild-clean.sh ios        # ios only
#
# From apps/mobile: invoked by `pnpm prebuild` / `pnpm prebuild:android` / `pnpm prebuild:ios`.
set -euo pipefail

MOBILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/mobile"
DO_ANDROID=0
DO_IOS=0

if [ "$#" -eq 0 ]; then
  DO_ANDROID=1
  DO_IOS=1
else
  for arg in "$@"; do
    case "$arg" in
      android) DO_ANDROID=1 ;;
      ios) DO_IOS=1 ;;
      *) echo "Unknown target: $arg" >&2; exit 1 ;;
    esac
  done
fi

if [ "$DO_ANDROID" = "1" ]; then
  echo "==> Removing $MOBILE/android (will regenerate)"
  rm -rf "$MOBILE/android"
fi

if [ "$DO_IOS" = "1" ]; then
  echo "==> Removing $MOBILE/ios (will regenerate)"
  rm -rf "$MOBILE/ios"
fi