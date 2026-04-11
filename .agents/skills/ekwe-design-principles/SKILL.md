---
name: ekwe-design-principles
description: Core spacing and typography design principles for the Ekwe app. Apply these rules when building or reviewing any UI screen, component, or layout.
---

# Ekwe Design Principles

These are the universal design rules that govern all UI decisions in Ekwe. Every screen, component, and layout must comply.

---

## Typography

### 1. Typographic Hierarchy

Establish a clear visual pecking order. The eye must instantly know what's most important.

- **Display** → **Heading** → **Body** → **Label** → **Caption**
- Achieve hierarchy through **size contrast** and **weight contrast** (serif display titles vs. sans-serif body).

### 2. Readability Over Style

- Body text minimum: **16px** (prevents iOS auto-zoom on inputs and ensures comfortable reading at arm's length).
- Label/caption text minimum: **12px** (never go below this).
- Line height: **1.4×–1.6×** the font size to give text breathing room.

### 3. Limit Typeface Count

- **2 typefaces max** — one for display/headings (`DMSerifDisplay`), one for body (`Outfit`).
- A third monospace (`SpaceMono`) is acceptable for code/data only.
- Never add a fourth typeface.

### 4. Consistent Modular Scale

Font sizes must follow a modular scale (each step ~1.25× the previous), not arbitrary jumps:

- Caption: `12` → Label: `14` → Body: `16` → Heading: `20` → Display: `32`

### 5. Letter Spacing Rules

- **Uppercase labels**: Positive tracking (`0.8–1.5px`) for legibility.
- **Large display text**: Slight negative tracking (`-0.5px`) for visual tightness.
- **Body text**: Zero tracking (default).

---

## Spacing

### 6. The 4px Spatial Grid

All spacing values must be multiples of **4px**:

- `4, 8, 12, 16, 20, 24, 32, 40, 48`
- No arbitrary values like `14`, `17`, `22`, or `40` for font sizes.
- Padding, margins, gaps, and dimensions all follow this grid.

### 7. Proximity = Relationship (Gestalt)

- Elements that are **related** → closer together.
- Elements that are **unrelated** → more space between them.
- A card's **internal padding** must be smaller than the **gap between cards**.

### 8. Generous Whitespace

- Premium design uses **more** whitespace, not less.
- White space creates focus and separates content zones.
- Cramped layouts feel cheap.

### 9. Vertical Rhythm

- Line height, paragraph spacing, and section spacing share the same base unit (4px).
- This creates a "beat" to the page that feels harmonious.

### 10. Consistent Section Spacing

- Screen edge padding: `24px` (6 × 4).
- Section gaps: `32–48px`.
- Component internal padding: `16px`.
- Element gaps within components: `8–12px`.

---

## Touch & Interaction

### 11. Touch Target Generosity

- Minimum interactive area: **48×48px** (Material Design) / **44×44pt** (Apple HIG).
- Minimum spacing between targets: **12px**.
- Use `hitSlop` to extend small visual elements to meet the 48px minimum.

### 12. Thumb Zone Awareness

- Critical actions in the **bottom 30%** of the screen.
- Primary CTAs pinned to the bottom with generous padding.
- Navigation and secondary actions in the upper zone.

---

## Color & Contrast

### 13. WCAG AA Minimum

- Normal text (< 18pt): **4.5:1** contrast ratio.
- Large text (≥ 18pt bold or ≥ 24pt regular): **3:1** contrast ratio.
- UI components and icons: **3:1** contrast ratio.

### 14. No Opacity Hacks for Text

- Never use `opacity` on text to create visual hierarchy.
- Use dedicated token colors (`text.primary`, `text.secondary`, `text.tertiary`) which have verified contrast ratios.

### 15. Semantic Color Usage

- **Brand colors** for identity and CTAs.
- **Status colors** for feedback (error, warning, success, info).
- **Neutral colors** for backgrounds, text, and borders.
- Never use raw hex codes — always reference NativeWind semantic classes (e.g. `bg-primary`, `text-zinc-500`).

---

## Layout

### 16. Safe Area Respect

- Always wrap screens in `SafeAreaView`.
- Account for notches, home indicators, and status bars.

### 17. Bottom-Anchored CTAs

- Primary action buttons pinned to the bottom of the screen.
- Minimum `40px` bottom padding from safe area edge.
- Full-width or near-full-width for primary actions.

### 18. Scroll Before Squeeze

- If content doesn't fit, scroll — don't shrink text or reduce spacing.
- Maintain the spatial grid even in scrollable views.

# Ekwe — Developer Skill Reference

## What you are building

Ekwe is a voice note translation app for Android and iOS built in React Native + Expo. Users receive voice notes in other languages from WhatsApp, Telegram, Signal, Instagram, Bumble and other apps. Ekwe transcribes and translates them. Two input paths: share intent (audio file shared directly to Ekwe) and floating bubble overlay (Ekwe's bubble floats over all apps, user taps it while the voice note plays, mic records it). Everything runs on-device — no server in v1.

## Non-negotiable rules

1. TypeScript strict. No `any`. No implicit returns. Every function has an explicit return type.
2. No raw error strings anywhere. Every error is a typed `EkweError` enum value from `src/constants/errors.ts`.
3. No hardcoded colors, spacing, or font sizes. Every visual value must use **NativeWind utility classes** (e.g., `bg-navy`, `text-primary`, `gap-4`). Avoid `StyleSheet.create` for layout, spacing, and styling in favor of `className`.
4. Every async service method returns `Result<T, EkweError>`. Nothing throws. Nothing rejects. Every caller checks the result.
5. No relative imports beyond one level. All imports are absolute from `src/`.
6. Functions under 30 lines. One responsibility per file. No side effects outside service methods.
7. Every component renders a loading state, an empty state, and an error state. None are afterthoughts.
8. FlatList for every list. Never ScrollView for list data.
9. Minimum 48px tap target on interactive elements (industry standard).
10. Elite Polish: All Pressables use `active:scale-95` with spring physics and Haptics.
11. No console.log in any file. Use Sentry for error reporting.

## Elite Design & Polish

1. **High-Contrast Pro Palette**:
   - Primary: `#0A1F30` (Navy)
   - Secondary: `#1A7EC8` (Accent Blue)
   - Dark: `Midnight Noir (#09090B)` — Pure depth.
   - Light: `Pure White (#FFFFFF)` — Sharp and clean.
   - Accents: Neutral Slate/Zinc scale (e.g. Slate 400 `#94A3B8` for secondary dark text).
2. **Home as Console**: Home screen must focus on the "Live Console" (Pulsing Mic/Record) rather than a list.
3. **Organic Motion**: All transitions use spring-physics (`damping: 15`, `stiffness: 300`).
4. **Haptics**: confirmed actions use `ImpactFeedbackStyle.Light`.

## File that must never be modified by the AI (via GEMINI.md)

- src/constants/errors.ts
- src/models/
- AndroidManifest.xml
- Info.plist
- ios/ShareExtension/

## Result type — use everywhere

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
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
themeSlice — resolved light/dark value, read by NativeWind components via `useColorScheme()`

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

Jest unit tests: use for all utils at 100% coverage, all service methods, all Zustand slice actions, component unit logic, and store hydration.
Maestro E2E: use for all UI flows — full onboarding, share intent cold/background/foreground, history CRUD, settings persistence, bubble enable + permission, FloatingResultCard, and permission denied gate.
Physical devices: Pixel 7, Samsung S23, Xiaomi Redmi, Oppo A78, iPhone 14 Pro, iPhone 12
