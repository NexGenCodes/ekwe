# Ekwe — Developer Skill Reference

## What you are building

Ekwe is a voice note translation app for Android and iOS built in React Native + Expo. Users receive voice notes in other languages from WhatsApp, Telegram, Signal, Instagram, Bumble and other apps. Ekwe transcribes and translates them. Two input paths: share intent (audio file shared directly to Ekwe) and floating bubble overlay (Ekwe's bubble floats over all apps, user taps it while the voice note plays, mic records it). Everything runs on-device — no server in v1.

## Non-negotiable rules

1. TypeScript strict. No `any`. No implicit returns. Every function has an explicit return type.
2. No raw error strings anywhere. Every error is a typed `EkweError` enum value from `src/constants/errors.ts`.
3. No hardcoded colours, spacing, or font sizes anywhere. Every visual value comes from `src/constants/tokens.light.ts` or `src/constants/tokens.dark.ts` via the resolved themeSlice.
4. Every async service method returns `Result<T, EkweError>`. Nothing throws. Nothing rejects. Every caller checks the result.
5. No relative imports beyond one level. All imports are absolute from `src/`.
6. Functions under 30 lines. One responsibility per file. No side effects outside service methods.
7. Every component renders a loading state, an empty state, and an error state. None are afterthoughts.
8. FlatList for every list. Never ScrollView for list data.
9. Minimum 44px tap target on every interactive element.
10. No console.log in any file. Use Sentry for error reporting.

## File that must never be modified by the AI (via GEMINI.md)

- src/constants/errors.ts
- src/constants/tokens.light.ts
- src/constants/tokens.dark.ts
- src/models/
- AndroidManifest.xml
- Info.plist
- ios/ShareExtension/

## Result type — use everywhere

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }
```

Every service method returns this. Every screen and hook checks `.ok` before proceeding. Every `.ok === false` path renders an EkweBanner.

## Error codes

All defined in src/constants/errors.ts as a TypeScript enum. The complete list:
EKWE_NO_SPEECH, EKWE_TOO_SHORT, EKWE_LOW_VOLUME, EKWE_INTERRUPTED,
EKWE_BAD_FORMAT, EKWE_PROCESSOR_FAIL, EKWE_EMPTY_TRANSCRIPT,
EKWE_NETWORK_LOST, EKWE_LANG_UNSUPPORTED, EKWE_MODEL_FAIL,
EKWE_LOW_QUALITY, EKWE_SHARE_COPY_FAIL, EKWE_PERMISSION_MIC,
EKWE_PERMISSION_OVERLAY, EKWE_SESSION_INTERRUPTED, EKWE_ONNX_LOAD_FAIL

## Services and what they own

AudioCapture — two input paths (bubble mic, share intent), converge to raw PCM
AudioProcessor — pre-emphasis → DeepFilterNet3 → Silero VAD → AGC → normalise → resample
VolumeManager — auto-raise before recording, restore after, force speaker routing
Transcription — @react-native-voice/voice, streaming + batch modes, franc-min detection
Translation — ML Kit, full transcript as one block, on-demand only
DeepLinkHandler — share intent in 3 app states (cold, background, foreground)

## Component rules

Every component folder: ComponentName.tsx, ComponentName.types.ts, ComponentName.test.tsx, index.ts
Components are pure presentational — they receive props and render UI
Logic lives in hooks in src/hooks/
Hooks call services
Components never call services directly

## Zustand store slices

audioSlice — recording state, transcript buffer, error code, session ID
historySlice — translation history, timestamp-based cleanup runs on hydration
settingsSlice — bubble enabled, theme preference, languages, audio toggles
themeSlice — resolved light/dark value, read by all components

## Android-specific critical notes

- Bubble foreground service: draw TYPE_APPLICATION_OVERLAY window FIRST, then startForegroundService() — Android 15 requirement
- Foreground service in AndroidManifest: foregroundServiceType="microphone" required for Android 14+
- Mic audio source: VOICE_RECOGNITION not VOICE_COMMUNICATION — prevents echo canceller suppressing speaker audio
- AudioPlaybackCapture: try first for bubble path, falls back to mic if blocked (all messaging apps block it)

## iOS-specific critical notes

- AVAudioSession: category .playAndRecord, options .mixWithOthers + .allowBluetooth before any recording
- .mixWithOthers is critical — without it the other app's audio pauses when mic activates
- Background mode in Info.plist: audio mode declared
- Share Extension is a separate native Swift Xcode target — communicates with main app via App Groups
- Live Activity maximum lifetime 8 hours — restart before expiry

## Commit format

One commit per phase, after all tests pass.
Format: conventional commits — feat:, fix:, chore:, test:, release:
Body must include: what was tested, which devices verified, known limitations

## Testing requirements

Jest unit tests: add test in __test__ in its folder and find a place to add __mock__ ,  all utils at 100% coverage, all service methods, all Zustand slice actions, error enum completeness, history cleanup timestamp logic, filler word removal, hallucination detection
Detox E2E: full onboarding, share intent cold/background/foreground, history CRUD, settings persistence, bubble enable + permission, FloatingResultCard, permission denied gate
Physical devices: Pixel 7, Samsung S23, Xiaomi Redmi, Oppo A78, iPhone 14 Pro, iPhone 12
