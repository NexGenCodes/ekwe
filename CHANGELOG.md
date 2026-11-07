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
  in `packages/shared/src/version.ts` (single source of truth).

## [Unreleased]

### Added

- The result screen now shows the text it produced. The translation (or the
  transcript, when there is no translation) is the hero of the card, with a
  heard-it line above it for dictated input. The audio was the only thing on
  screen, so the words a voice was rendering could not be read, corrected, or
  copied from the same place.
- The result text is editable. Tapping it drops to an editor with only Cancel
  and Convert — deliberately no player, waveform, or Send, because the audio on
  screen would be the pre-edit render and would no longer match the text being
  read. Convert re-renders the edited text in the same voice and returns to the
  result. Editing does not re-translate: the text is already in its final
  language, so re-running translation would pay for a machine translation of the
  user's own words.
- Both texts are now editable, not just the artifact. When a translation exists
  the words you said are shown as their own tappable line above it, because a
  mistranslation is usually a mishearing and the fix belongs to the source. The
  editor is told which document it is holding, so Convert re-renders the field
  you corrected and leaves the other one alone. With no translation the result
  _is_ the transcript, and editing it edits the transcript.
- Re-renders are rate-limited to one every 2.5s, and a refused re-render is now
  silent. Regenerate is a re-roll; explaining that a tap did nothing interrupted
  the pause it was meant to protect.
- Echo's translated result now plays the original voice note alongside the
  read-aloud translation, so the source can be re-checked without leaving the
  result. The result's share control was removed; sharing remains available
  from History and Speech Studio.
- `ShareOutService.shareArtifact` is now the single send path. It prefers the
  audio file, falls back to text, and reports failure instead of opening an
  empty share sheet. History and Speech Studio no longer call a share sheet
  directly.
- `CopyService` now owns the share signature for every copy. Five call sites
  used to decide independently, so the same result pasted from the History row
  came out unsigned while the same text copied from the result screen was
  signed.
- `docs/speech-studio.md`, and a rewritten `docs/naming.md` covering the
  surface-vs-reporting split.
- Speech Studio notes are stored with `origin = "speech-studio"` instead of
  `"studio"`, which collided with `STUDIO_VOICE_ID` — a voice id, and an
  unrelated field that happened to share a string. Telemetry keeps `"studio"`:
  `result_shared.source` is a frozen reporting contract and existing dashboards
  must not break.

- History is now tagged by capture surface — Speech Studio, Echo, Orb — with a filter
  for each and an empty state that explains what belongs there. Previously the
  filter split entries by whether a translation existed, which the row already
  showed.
- Speech Studio now writes to History. The Worker already computed the
  transcript and translation to render speech and discarded them; it now
  returns both, at no extra inference cost, so what you said or typed is
  archived along with the voice that rendered it.
- History records which machine-translation provider translated a note,
  separately from the speech-to-text provider that heard it. The MT provider
  was previously fetched and thrown away.
- `POST /synthesize` returns the transcript and translation it produced.
- Speech Studio on the home screen: record or type text, choose a target language
  and voice, edit the result, then share a translated voice note to WhatsApp and
  other apps.
- A voice picker with one free Standard voice and two Pro Studio voices —
  Clear and Warm — each in a male and female variant.
- Pro live-streaming quota enforcement with a daily streaming allowance.
- Provider health tracking, circuit breaking, and failover for translation,
  transcription, and speech requests.
- A hybrid speech cache: short clips stay in Key-Value storage, while larger
  clips use R2.
- Installer-source detection for store builds and sideloaded APKs.

### Changed

- The conversion surface is now **Speech Studio**, and its History origin value
  is `speech-studio` (was `studio`). The `HistoryOrigin` union no longer accepts
  the old value and does not fall back to it. Analytics still report the
  surface as `studio`: the reporting vocabulary is frozen, so renaming a
  surface cannot move a dashboard key.
- Regenerate now re-rolls the render of the text on screen. It previously
  re-ran the full conversion from the transcript, which silently discarded an
  edit and replaced the user's wording with a fresh machine translation.
- Re-renders are rate-limited to one every 2.5s. A first conversion is not, so
  changing voice and converting again still works immediately.
- Auto-copy to Clipboard is now visibly Pro-only. It was the one Smart Feature
  row whose switch rendered and toggled for free users, leaving the tier gate on
  the pipeline as the only thing stopping a paid behaviour.
- The chooser title is "Send with Ekwe" rather than naming the inbound feature
  on the outbound path.

- History stores one row per capture instead of two. Translating a voice note
  previously left an orphan transcript-only row beside it, because the dedup
  lookup keyed on entry type and the two rows could never match. A capture is
  now identified by a `capture_id` and a later translation updates it in
  place, which is what removes the duplicate.
- Echo now saves transliteration, which it was discarding. Transliteration is
  what makes a non-Latin script readable, and the detail sheet already had a
  place to show it.
- History stores no audio and never did. The synthesized speech is a rendering
  of text that is already kept, and every capture surface deleted it at the end
  of its session regardless.
- The History filter is now Speech Studio / Echo / Orb instead of All /
  Transcription / Translation.
- Renamed the TTS surface to speech. `POST /synthesize` now returns JSON with
  base64 audio and replaces `POST /tts`.
- Daily speech quotas are now 5,000 characters for Free and 15,000 for Pro.
- Usage responses now use meter snapshots, and the app shows translation,
  transcription, and speech usage separately.
- Update manifest writes and device notifications now use admin-authenticated
  Worker routes.
- Flutterwave events now use the consolidated `POST /webhook` route.
- The release workflow rebases onto the latest `master` before pushing a
  version bump.
- Native audio APIs now include remuxing, installer-source detection, and
  asynchronous system-theme queries on supported platforms.
- Payment currency now defaults to NGN and is chosen manually in the profile.
  The Worker no longer infers a currency from the request's country, so a
  device or network location can no longer show prices in the wrong currency.
  Previously stored currencies are preserved; unsupported values fall back to
  NGN.

### Fixed

- Edge TTS synthesis no longer fails with `403 Forbidden` on every request.
  Microsoft made the v2 `Sec-MS-GEC` token mandatory in October 2026; the
  Worker now sends the `<16 hex>-<64 hex>` token with the `2-` version prefix
  instead of the retired single SHA-256 digest.
- The nightly tombstone purge no longer fails with
  `history_purge_tombstones is service_role only`. The function reads the
  `role` setting, which PostgREST sets per request but a Hyperdrive connection
  leaves unset; the queue now switches to `service_role` inside the
  transaction and it reverts when the transaction ends.
- Circuit-breaker openings are logged at warning level instead of error.
  A provider outage is already reported by the request that failed, so each
  expected opening filed a duplicate Sentry issue.
- Shared audio sent from another app no longer fails on a binary built before
  the native `options` argument existed. The call falls back to the older
  native signature, and `runtimeVersion` now uses the native fingerprint so a
  JS-only update cannot be delivered across a native API change.
- Outgoing voice notes now declare `audio/ogg; codecs=opus` verbatim.
  `expo-sharing` set the type via `Intent.setTypeAndNormalize`, which strips
  everything after the `;`, so WhatsApp and Telegram received a bare
  `audio/ogg` and rendered the note as an audio document instead of a playable
  voice note. The type is now set exactly, through the native module.
- An edit to a result with no translation was discarded. The re-rendered audio
  used the edited words while History kept recording the original transcript.

- Translating a shared voice note no longer leaves a duplicate transcript-only
  entry in History beside the translated one.
- Clearing or re-recording in Speech Studio no longer overwrites the previous
  note's History entry.
- A Speech Studio capture with no target language no longer records `"none"` as
  its target language.
- Echo's read-aloud button no longer leaves a generated audio file behind on
  every tap, and switching result tabs no longer orphans one.
- History no longer displays a bare platform name as the source app, which is
  what the old `"ios"` placeholder resolved to.
- Provider failures now fail over or fail fast instead of repeatedly sending
  requests to an unhealthy provider.
- OTP rate limiting fails closed when its backing Durable Object is
  unavailable.
- Failed maintenance jobs now reach a dead-letter queue and are reported.
- Streaming frames and history-sync payloads are validated before they enter
  the client data flow.
- The streaming Durable Object no longer opens duplicate provider sockets for
  the same audio session.
- Android system-bar icons now follow the active light or dark theme.

### Removed

- The unused `voice_notes` storage bucket, along with its policies. It allowed
  25 MB per user of user-writable audio storage that no code path created,
  expired, or accounted for.
- The unreachable Translate screen and the shared-audio branch of the result
  route, neither of which could be reached from any navigation path.
- On-device speech fallback. Voice output is unavailable after the daily
  speech quota is exhausted.
- The old `/tts`, `/push-tokens`, `/push-notify`, `POST /update/manifest`, and
  `/webhook/flutterwave` Worker routes.
- Premium text input is capped at 2,400 characters per request, down from
  10,000.

## [1.3.3] - 2026-11-07

### Added

- Orb service with overlay permission flow and iOS guard.
- Quota raise: 25 translations/day Free and 2,000/month Pro, 500 transcription minutes/month Pro softcap, 100k speech hard cap, 60 stream minutes/month with 4 concurrent.

### Fixed

- Stop Sentry noise from Wit.ai hallucinations and harden Flutterwave reconciliation.
- Raise translate, transcribe, speech, and stream quota caps per the new limits.

## [1.3.2] - 2026-11-05

### Fixed

- Correct Ogg duration metadata and harden usage refresh and abort handling.

## [1.3.1] - 2026-11-05

### Added

- Profile UI/UX redesign with deterministic avatars and Pro customization, and quota metering refactor.

### Fixed

- History import hardening, lint violations, and stale placeholder purge; backend and frontend race conditions and performance issues resolved; Cloudflare Worker URL hostname corrected.
- Sync D1 schema, JWT revocation, toFileUri, metering cap, ExecutionContext casts, and KV cooldown migration test failures.

### Changed

- Local-first sync: dirty-flag push protocol replaces the outbox state machine.

## [1.3.0] - 2026-10-23

### Changed

- The backend is now Cloudflare-only. D1 is the production database; Supabase,
  the legacy Postgres package, and the unused cache database were removed from
  the codebase.
- Authentication, sync, billing, and usage enforcement now run through the
  Worker. D1 migrations are applied as part of the Worker deploy.
- AI usage now shares one monthly credit pool across translation,
  transcription, speech, and live dictation. FREE and PAID caps are enforced
  server-side.
- User-facing plans are named FREE and PAID consistently across the app, share
  extension, website, and API messages.
- The mobile app now owns its SQLite schema, and sync uses the Worker's
  D1-backed history and outbox contract.

### Removed

- Supabase, the legacy `packages/db` Postgres package, and the unused
  `ekwe-cache` D1 database.

## [1.2.13] - 2026-10-21

### Fixed

- Edge TTS synthesis works again after Microsoft made the v2 Sec-MS-GEC token mandatory.
- Nightly history tombstone cleanup no longer fails on the direct database connection.
- Provider circuit-breaker openings no longer file duplicate Sentry issues.
- Shared audio sent from another app works on builds that predate the native `options` argument; runtime updates are now pinned to the native fingerprint.

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
- Instant translation across the supported language catalog.
- Local history and playback.
- Share extension, offline translation for core languages, and audio playback
  fixes across Android devices.

## [1.0.0] - 2026-07

### Added

- Initial Android release: voice recording and import, real-time translation,
  and local history.
