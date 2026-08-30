# Changelog

All notable changes to the Ekwe Android app are documented here. The GitHub
release workflow (`/.github/workflows/deploy.yml`) publishes each `v*` tag and
regenerates this file's per-release notes from commit history.

## Format

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers mirror Git tags (`v1.0.0` → `1.0.0`) and the `versionCode` in
`apps/mobile/app.json` (single source of truth).

## [1.2.2] - 2026-08-30

### Fixed

- Crash on startup (Android): removed a `setBackgroundMessageHandler` call that no
  longer exists in expo-notifications SDK 57, which threw at bundle load and
  prevented the app from ever rendering.
- OTP input: restoring editable/correctable code entry after auto-fill.

### Changed

- Release APKs are labeled and downloaded per device ABI (`arm64-v8a`,
  `armeabi-v7a`) with matching checksums on the landing site and in-app.
- Landing site changelog and download labels reflect the new version.

## [1.0.0] - 2026-08-18

### Added

- Initial Android release.

## [Unreleased]

### Added

### Changed

### Fixed

### Removed
