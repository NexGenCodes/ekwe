# Changelog

All notable changes to the Ekwe Android app are documented here.

## How this file is maintained

- `CHANGELOG.md` is the single source of truth. The landing-site changelog
  page (`/pages/changelog.html`) is generated from this file at build time.
- Manual releases (`workflow_dispatch` with the "release notes" input) write
  those notes here; the site and the GitHub release then share them.
- Auto-bump releases (triggered by native pushes) have no curated entry here
  and rely on the GitHub auto-generated release notes.
- Version numbers mirror Git tags (`v1.2.6` → `1.2.6`) and the `versionCode`
  in `packages/shared/version.ts` (single source of truth).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

## [1.2.6] - 2026-09-10

### Changed

- Landing site now serves a single universal Android APK; iOS is shown as
  "coming soon".
- Package names were scoped and Sentry logging was quieted for expected
  errors.

### Fixed

- Audio playback could release the player twice while unmounting, which
  crashed the waveform screen.
- The sync flow now checks connectivity first and fails gracefully instead of
  throwing when the device is offline.
- Removed a redundant app-background dismiss that closed the active echo flow
  unexpectedly.
- Broken Privacy / Terms / Changelog links in the site footer.

## [1.2.5] - 2026-08-31

### Fixed

- Worker webhook processing is atomic and idempotent — duplicate events no
  longer cause duplicate side effects.
- Streaming responses abort cleanly when a client disconnects.

## [1.2.4] - 2026-08-31

### Added

- Worker-resolved automatic currency is shown in the profile and the currency
  picker.

### Changed

- Premium TTS character ceiling raised to 5,000; iOS uses on-device speech
  where available.

### Fixed

- Error causes are surfaced in logs and non-Error values are stringified
  safely.
- Sentry is only initialized in production builds.

## [1.2.3] - 2026-08-30

### Changed

- Translation switched to GLM-4.7-Flash with a language cache migration for
  faster, lower-cost translations.

## [1.2.2] - 2026-08-30

### Added

- Per-user OTP rate limiting and currency symbols.
- Branded transactional email templates.

### Fixed

- Critical startup crash on newer Android devices.

## [1.2.1] - 2026-08-28

### Added

- Per-day premium TTS character quota with tighter billing enforcement.

### Changed

- In-app "check for update" flow and native APK update notifications.
- Release artifacts are published per device ABI with checksums.

### Fixed

- Security and rate-limit hardening for OTP and billing flows.

## [1.1.x] - 2026-08-21

### Added

- Voice recording, import, and AI-powered speech-to-text.
- Instant translation in 130+ languages.
- Local history and playback.
- Share extension, offline translation for core languages, and audio playback
  fixes across Android devices.

## [1.0.0] - 2026-07

### Added

- Initial Android release: voice recording and import, real-time translation,
  and local history.
