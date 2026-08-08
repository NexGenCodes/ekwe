# TODO

1. Conversation mode — live back-and-forth translation between two speakers
2. Audio streaming — real-time live transcription as the user speaks
3. Offline mode — local on-device translation when there is no internet
4. Widget — quick translate from home screen
5. Batch/file upload — translate text or audio files in bulk
6. Incognito listening — play WhatsApp/Telegram voice notes without triggering blue check via Accessibility Service (Android only). Frame as assistive tech for deaf/hard-of-hearing users for Play Store compliance. Foundation exists: VoiceNoteScanner.ts, AccessibilityDisclosure.tsx, expo-audio already in project.

## Libraries / infra to adopt

7. i18n — UI localization with `i18next` + `react-i18next` (glue: `expo-localization` already installed). A translation app targets non-English users by definition; retrofitting later means touching every string file. Skip if v1 is English-only.
8. Keyboard UX — swap `KeyboardAvoidingView` (used in AuthShell.tsx and (tabs)/index.tsx) for `react-native-keyboard-controller` for smooth keyboard-following / scroll-on-keyboard and gesture dismissal. Skip if current UX is fine.
9. OTA updates — add `expo-updates` + EAS Update so JS-only fixes/features ship without a new store review (~20 min vs 1–2 weeks). Needed only if iterating post-launch.
10. Notifications (conditional) — `expo-notifications` for "translation ready" push if a background-translation/offline-queue flow ships. Requires re-adding notification icons.

## Features

11. Lens (camera translate) — point the camera at signs/menus/documents and translate text live (OCR frame → translate → overlay). Building blocks: expo-camera, expo-image-manipulator, OCR (Apple Vision via native module / expo-module, or a cloud OCR path in the existing worker), and the translation pipeline already in place. Reuses the same source-language auto-detect wiring.

## Tooling notes

- Icon pipeline: single source `apps/mobile/assets/ekwe-logo.svg` + `pnpm gen:icons` (script at `scripts/icons/generate-icons.mjs`); glyph/splash colors read from `packages/shared/token/colors.ts` (`lightColors.brand`). Every mobile `prebuild*` script runs `gen:tokens` then `gen:icons` first. Rebrand = change one token + `pnpm gen:icons` + re-prebuild.

- EAS iOS signing is blocked until `apps/mobile/app.json` → `ios.appleTeamId` is set (needs the developer's Apple Developer Team ID). Set it before any `eas build --platform ios`; it lives in Apple Developer → Membership. `ios.bundleIdentifier` = `com.ekwe.app` is already set.

## Security

12. Worker per-user usage quota — DEFERRED (decision needed on limits). Current state: `user_usage` table (`user_id`/`month`/`usage_count`/`last_request_at`) powers only cooldown via `check_preflight` RPC (FREE 3s, PREMIUM 1s, service_role only, auth.uid() guard); `increment_user_usage` RPC exists but is never called; tiers are effectively unlimited — a FREE account can script ~28.8k requests/day under cooldown alone. Research done: `user_usage` schema + check_preflight/increment_user_usage migrations (through `20260804000000_lockdown_rpc_and_fix_retention.sql`), worker preflight wiring (`apps/worker/src/index.ts:146-183` + KV 2s cache), `apps/worker/src/utils/preflight.ts`, guards in `apps/worker/src/security.ts`, tier limits in `packages/shared/plans.ts`. To implement later: pick metric (daily count / daily audio-seconds / monthly count) + numeric limits, then add a day-keyed atomic consume RPC (fail-closed like preflight) and wire it into `/transcribe` + `/translate` before provider dispatch. Decisions needed: quota metric, FREE/PREMIUM limits, 429 vs grace, UTC-midnight vs rolling window.
