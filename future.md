# TODO

1. Conversation mode — live back-and-forth translation between two speakers
2. Offline mode — local on-device translation when there is no internet
3. Widget — quick translate from home screen
4. Batch/file upload — translate text or audio files in bulk

5. Mobile test infrastructure — Android runs on `jest-expo`; the worker runs
   `vitest` with `@cloudflare/vitest-pool-workers`. **Plumbing is done**:
   `@testing-library/react-native` v14 + `test-renderer` installed, jest
   config now extends `jest-expo`'s preset (transforms `.mjs` for
   lucide-react-native, maps `@/*`), `jest.setup.js` registers RNTL's built-in
   matchers. First component suite covers `QuotaUsageCard` (healthy / near-limit
   / exhausted / unlimited / loading / error). Remaining: write RTL tests for
   the high-value screens — TranslateScreen, HistoryScreen empty/list states,
   AuthShell branches, ExpressiveInput voice/text modes. Focus on
   empty/loading/error states and the recent useResultPipeline retry-guard
   behavior. Estimated 2-3 days for 80% coverage on core screens.

### Libraries / infra to adopt

6. i18n — UI localization with `i18next` + `react-i18next` (glue: `expo-localization` already installed). A translation app targets non-English users by definition; retrofitting later means touching every string file. Skip if v1 is English-only.
7. OTA updates — add `expo-updates` + EAS Update so JS-only fixes/features ship without a new store review (~20 min vs 1–2 weeks). Needed only if iterating post-launch.
8. Notifications (conditional) — `expo-notifications` for "translation ready" push if a background-translation/offline-queue flow ships. Requires re-adding notification icons.

## Features

9. Lens (camera translate) — point the camera at signs/menus/documents and translate text live (OCR frame → translate → overlay). Building blocks: expo-camera, expo-image-manipulator, OCR (Apple Vision via native module / expo-module, or a cloud OCR path in the existing worker), and the translation pipeline already in place. Reuses the same source-language auto-detect wiring.
10. iOS Aura (ambient audio capture) — pending iOS concept for cross-app ambient transcription.
    - **Platform constraints**: iOS strictly prohibits global floating overlay bubble APIs (like Android's `SYSTEM_ALERT_WINDOW`), and does not allow background inter-app audio loopback capture.
    - **Current route (iOS ≤ 26)**: ReplayKit Broadcast Upload Extension (`RPBroadcastSampleHandler` receiving `RPSampleBufferType.audioApp` buffers). Requires user-initiated broadcast session from Control Center or `RPSystemBroadcastPickerView`. IPC to host app via shared App Group (`group.com.ekwe.app`) and `EchoHistoryStore.swift`. Hard 50 MB extension memory ceiling; no Audio Units allowed.
    - **Future route (iOS 27+)**: ScreenCaptureKit on iOS (`SCContentSharingPicker` + `SCStream` with `capturesAudio = true`). Replaces ReplayKit broadcast extensions directly within the host app without requiring a separate extension process.

## Tooling notes

- Icon pipeline: single source `apps/mobile/assets/ekwe-logo.svg` + `pnpm gen:icons` (script at `scripts/icons/generate-icons.mjs`); glyph/splash colors read from `packages/shared/token/colors.ts` (`lightColors.brand`). Every mobile `prebuild*` script runs `gen:tokens` then `gen:icons` first. Rebrand = change one token + `pnpm gen:icons` + re-prebuild.

- EAS iOS signing is blocked until `apps/mobile/app.json` → `ios.appleTeamId` is set (needs the developer's Apple Developer Team ID). Set it before any `eas build --platform ios`; it lives in Apple Developer → Membership. `ios.bundleIdentifier` = `com.ekwe.app` is already set.

## Shipped (implemented, no longer TODO)

- **Audio streaming** — real-time live transcription End-to-end: Durable Object (`apps/worker/src/stream-do.ts`), `/transcribe/stream` WS route, `StreamTranscriber` on mobile, live mode in `useVoiceDictation` / `TranslationInterface` (PREMIUM streaming only).
- **Per-user usage quota** — daily request cap per type (translate/transcribe). Limits set in `packages/shared/plans.ts` (FREE 25/day each, PREMIUM 100/day each). Migration `20260810000000_add_daily_usage_quota.sql`; worker `checkPreflight` / `trackBillableSuccess`. See `docs/quota-implementation.md`.
- **Photo/voice-note bulk import, history sync, billing** — see git log for `feat:` commits; these shipped before this doc's last refactor.
