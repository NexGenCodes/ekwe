# Ekwe

[![Landing Page](https://img.shields.io/badge/Website-ekwe.pages.dev-blue?style=for-the-badge&logo=googlechrome)](https://ekwe.pages.dev)
[![Download APK](https://img.shields.io/badge/Download-APK-green?style=for-the-badge&logo=android)](https://github.com/NexGenCodes/ekwe/releases/latest)
[![GitHub Release](https://img.shields.io/badge/GitHub-Release-gray?style=for-the-badge&logo=github)](https://github.com/NexGenCodes/ekwe/releases/latest)

Ekwe is a cross-platform voice translation app for Android and iOS built with React Native and Expo. It turns spoken and written words into translated, spoken audio you can share to any social or messaging app.

## Core Features

- **Speech Studio (Home):** record live dictation or type text, choose a target language and voice, edit the result, then share a translated voice note through WhatsApp, Messenger, or any other app. The Worker uses `/translate` and `/synthesize`.
- **Echo (Share-In):** Ekwe is a registered share target. Share an audio file from external apps, including WhatsApp, voice messaging apps, and file managers, directly into Ekwe for transcription and translation.
- **History:** one searchable, exportable row per capture, tagged by the surface that produced it — Studio, Echo, or Orb. History stores **text only**: audio is a rendering of text that is already kept, so it is regenerated on demand rather than persisted. The Worker's content-addressed speech cache makes that free inside its TTL.
- **Live Streaming Transcription:** Pro users can use real-time WebSocket streaming (`GET /transcribe/stream`) with native Opus capture and a per-user Durable Object session. A provider key that refuses connections is retried once before being skipped for a cooldown, so a single transient error never costs a session while a genuinely dead key stops costing every session.
- **Push Notifications:** app-update notices fan out to Expo in batches of 100 per request, the format Expo itself requires, and registrations are validated as real `ExponentPushToken[...]` values. A malformed token is rejected at the edge instead of consuming a send, and a large audience no longer fails wholesale.
- **Tiers & Billing:** Free and Pro plans use daily translation, transcription, and speech quotas. Pro adds four studio voices and live streaming; Flutterwave handles checkout. Speech is available on both tiers, and every tier may audition every voice — Pro voices are locked only when you commit to one. Every redemption is claimed against the provider's transaction id, so one payment grants exactly one period no matter how often the client retries it.
- **Reliable AI Pipeline:** provider failover, health tracking, speech caching in Key-Value storage and R2, and separate usage meters keep requests observable and recoverable. A provider that answers but declines — silence in a quiet clip, or a hallucination it filtered out — is recorded as neither a success nor a failure, so three quiet recordings cannot take a working provider offline for everyone.
- **Audio Capture:** custom native modules for iOS and Android provide low-latency capture, audio remuxing, WAV/Opus encoding, and Ogg muxing. Capture teardown is idempotent, so a JS-initiated stop racing the VAD auto-stop cannot finalize the file twice.
- **Premium UI System:** a custom design-token system, OLED-friendly dark mode scaling, custom haptics, spring-physics animations, and voice-picker gating for Pro features. Every interactive control reports a button role to screen readers through the shared pressable, and destructive confirmations expose their disabled state and unlock hint instead of relying on dimmed styling alone.

## Worker API

The Worker exposes the primary routes used by the mobile app:

| Route                              | Purpose                                                        |
| ---------------------------------- | -------------------------------------------------------------- |
| `GET /health`                      | Report provider and binding health                             |
| `GET /pricing`                     | Return plan prices in the requested currency                   |
| `POST /translate`                  | Translate text                                                 |
| `POST /transcribe`                 | Transcribe uploaded audio                                      |
| `GET /transcribe/stream`           | Stream live transcription over WebSocket                       |
| `POST /synthesize`                 | Translate and synthesize speech; return JSON with an audio URL |
| `GET /speech/:key`                 | Serve signed audio from the speech cache                       |
| `GET /usage`                       | Return daily translation, transcription, and speech meters     |
| `POST /webhook`                    | Process Flutterwave events                                     |
| `POST /auth/otp`                   | Email a one-time sign-in code                                  |
| `POST /billing/checkout`           | Start a Flutterwave checkout                                   |
| `POST /billing/verify-transaction` | Claim a paid transaction and grant the period                  |
| `GET /billing/flags`               | Report which payment providers are enabled                     |
| `POST /devices/token`              | Register a device push token                                   |
| `GET /update/manifest`             | Read the latest APK manifest                                   |
| `POST /admin/update/manifest`      | Publish an APK manifest with admin authentication              |
| `POST /admin/update/notify`        | Notify devices with admin authentication                       |

> **API compatibility:** Use `/synthesize` instead of `/tts`. The response is
> JSON carrying an `audioUrl` rather than inline audio — the worker stores the
> clip in its speech cache and serves it from `GET /speech/:key`, so the
> response stays small however long the clip is. Apply the Supabase migrations
> before deploying the new Worker, and ship the Worker and mobile client
> together because endpoint names and response formats changed.

### Request safety

- **Auth is part of the route type.** Every route declares its auth level (`none`, `jwt`, `optional-jwt`, `admin`) and its billing preflight, so a handler cannot be registered unprotected.
- **Every user-authenticated route is rate limited,** including the route that also accepts anonymous callers, which is bounded by client IP. Public routes are limited where it matters at the service layer instead — `/auth/otp` throttles through its own Durable Object — and admin routes are gated by a shared secret rather than per user.
- **Upload limits are checked server-side.** The declared audio duration is cross-checked against the upload size, so a caller cannot state any duration they like.
- **Payments are idempotent.** `/billing/verify-transaction` claims the transaction id before granting anything; a replay returns the period the first claim recorded instead of extending again.
- **A malformed request body cannot become a generic 500.** `HttpError` is mapped to its own status and code on public, admin, and optional-auth routes, not only on authenticated ones.

## Technology Stack

- **Framework:** [Expo](https://expo.dev) / [React Native](https://reactnative.dev) (monorepo with Turborepo + pnpm workspaces)
- **App State:** `@legendapp/state` + `react-native-mmkv`
- **Animations:** `react-native-reanimated`
- **Audio:** `expo-audio`
- **Local Database:** `expo-sqlite` + `drizzle-orm`
- **Backend:** Cloudflare Workers (provider failover, streaming, queues, Durable Objects, KV, D1, and R2) + Supabase
- **Database:** Supabase (PostgreSQL, RLS, edge functions)
- **Payments:** Flutterwave (checkout + webhooks + reconciliation)
- **AI Providers:** Deepgram, AssemblyAI, Gladia, Wit.ai, Groq, Mistral, Gemini, Cohere, Cloudflare AI, OpenRouter, ElevenLabs, Edge
- **Error Tracking:** Sentry
- **Analytics:** PostHog
- **Testing:** Vitest (mobile, worker, and shared packages)

## Project Structure

```
ekwe/
├── apps/
│   ├── mobile/          # Expo React Native app (Speech Studio + Echo)
│   ├── web/             # Landing site (Cloudflare Pages)
│   └── worker/          # Cloudflare Worker backend (API + cron + queues)
├── packages/
│   ├── shared/          # Shared types, plans, schemas, design tokens
│   └── db/              # Drizzle schema for the local SQLite layer
├── scripts/             # Build, token & versioning scripts
├── supabase/            # Database migrations, RLS & edge functions
└── turbo.json           # Turborepo config
```

## Download

A single universal APK is published — one build for every Android device
(64-bit arm64 and 32-bit ARM):

**[Download Ekwe APK](https://pub-dcd31dbfad344d278cc48d4601c658fc.r2.dev/app-release.apk)**

### Web

Visit the official landing page for app info, changelog, and download:

**[ekwe.pages.dev](https://ekwe.pages.dev)**

### Local (GitHub)

For developers and sideloading, the APK and its checksum are also available
on GitHub Releases:

**[GitHub Releases](https://github.com/NexGenCodes/ekwe/releases/latest)**

## Getting Started

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Run the Worker locally** (needed for API features):

   ```bash
   pnpm --filter @ekwe/worker dev
   ```

3. **Start the Mobile App:**

   ```bash
   pnpm dev
   ```

4. **Run on a Device or Simulator:**

   ```bash
   pnpm ios
   # - or -
   pnpm android
   ```

5. **Database migrations:**

   ```bash
   pnpm --filter @ekwe/db migrate
   ```

## Tests

```bash
pnpm test        # all suites
pnpm test:ci     # the secrets scan + coverage run, matching the CI gates
bash apps/mobile/modules/ekwe-native/cpp/tests/run-tests.sh
```

The last one is the native capture suite: host-side C++ checks for the logic that
otherwise only shows up on a device. It builds with ASan when the toolchain
supports it.

## Design Philosophy

Ekwe strictly follows a "Pro UI" standard:

- **Typography:** Two typefaces max (`DMSerifDisplay` and `Outfit`) using standard modular scales.
- **Interaction:** Micro-interactions in the 150–300ms range with platform-native easing.
- **Touch Areas:** WCAG-standard touchable surfaces (44×44pt min) with contrast scaling.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
