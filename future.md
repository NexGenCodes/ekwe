# TODO

1. Conversation mode — live back-and-forth translation between two speakers
2. Audio streaming — real-time live transcription as the user speaks
3. Offline mode — local on-device translation when there is no internet
4. Widget — quick translate from home screen
5. Batch/file upload — translate text or audio files in bulk

6. Mobile test infrastructure — vitest + React Native preset installed, but `@testing-library/react-native` is not wired up. Needed for component regression coverage on high-value screens (TranslateScreen, HistoryScreen empty/list states, AuthShell branches, ExpressiveInput voice/text modes). Tasks: install RTL, configure vitest RN preset (transform/env), add jest-native matchers, add MSW mock handlers for mobile API surface, write tests for TranslateScreen + History + AuthShell. Focus on empty/loading/error states and the recent useResultPipeline retry-guard behavior. Estimated 2-3 days to plumbing + 80% coverage on core screens.

### Libraries / infra to adopt

6. i18n — UI localization with `i18next` + `react-i18next` (glue: `expo-localization` already installed). A translation app targets non-English users by definition; retrofitting later means touching every string file. Skip if v1 is English-only.
7. OTA updates — add `expo-updates` + EAS Update so JS-only fixes/features ship without a new store review (~20 min vs 1–2 weeks). Needed only if iterating post-launch.
8. Notifications (conditional) — `expo-notifications` for "translation ready" push if a background-translation/offline-queue flow ships. Requires re-adding notification icons.

## Features

9. Lens (camera translate) — point the camera at signs/menus/documents and translate text live (OCR frame → translate → overlay). Building blocks: expo-camera, expo-image-manipulator, OCR (Apple Vision via native module / expo-module, or a cloud OCR path in the existing worker), and the translation pipeline already in place. Reuses the same source-language auto-detect wiring.

## Tooling notes

- Icon pipeline: single source `apps/mobile/assets/ekwe-logo.svg` + `pnpm gen:icons` (script at `scripts/icons/generate-icons.mjs`); glyph/splash colors read from `packages/shared/token/colors.ts` (`lightColors.brand`). Every mobile `prebuild*` script runs `gen:tokens` then `gen:icons` first. Rebrand = change one token + `pnpm gen:icons` + re-prebuild.

- EAS iOS signing is blocked until `apps/mobile/app.json` → `ios.appleTeamId` is set (needs the developer's Apple Developer Team ID). Set it before any `eas build --platform ios`; it lives in Apple Developer → Membership. `ios.bundleIdentifier` = `com.ekwe.app` is already set.

## Security

See `docs/quota-implementation.md` — the per-user usage quota is now a planned implementation (metric decision: daily request count, limits pending).
