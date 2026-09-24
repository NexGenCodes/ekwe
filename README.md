# Ekwe

[![Landing Page](https://img.shields.io/badge/Website-ekwe.pages.dev-blue?style=for-the-badge&logo=googlechrome)](https://ekwe.pages.dev)
[![Download APK](https://img.shields.io/badge/Download-APK-green?style=for-the-badge&logo=android)](https://github.com/NexGenCodes/ekwe/releases/latest)
[![GitHub Release](https://img.shields.io/badge/GitHub-Release-gray?style=for-the-badge&logo=github)](https://github.com/NexGenCodes/ekwe/releases/latest)

Ekwe is a cross-platform voice translation app for Android and iOS built with React Native and Expo. It turns spoken and written words into translated, spoken audio you can share to any social or messaging app.

## Core Features

- **Voice Studio (Home):** the share-out hub. Record live dictation or type text, pick a target language and voice, and Ekwe produces a natural translated voice note via the Cloudflare Worker (`/synthesize`, `/translate`), ready to share out to WhatsApp, Messenger, and every other target app.
- **Echo (Share-In):** Ekwe is a registered share target. Share an audio file from external apps (WhatsApp, voice messaging, file managers) directly into Ekwe for instant transcription and translation, resolved through the worker backend.
- **Live Streaming Transcription:** real-time WebSocket streaming (`/transcribe/stream`) with on-device Opus capture and a per-user Durable Object session, giving live transcripts as you speak.
- **Tiers & Billing:** Free and Pro plans with daily usage quotas, gated by the worker's preflight system and paid via Flutterwave checkout. TTS is available on all tiers.
- **Audio Capture:** custom native modules (iOS Swift/Objective-C++, Android Kotlin/JNI + C++) for low-latency capture, WAV/Opus encoding, and Ogg muxing.
- **Premium UI System:** a custom design-token system (`src/constants/` + `src/components/ui/`), OLED-friendly dark mode scaling, custom haptics, and spring-physics animations.

## Technology Stack

- **Framework:** [Expo](https://expo.dev) / [React Native](https://reactnative.dev) (monorepo with Turborepo + pnpm workspaces)
- **App State:** `@legendapp/state` + `react-native-mmkv`
- **Animations:** `react-native-reanimated`
- **Audio:** `expo-audio`
- **Local Database:** `expo-sqlite` + `drizzle-orm`
- **Backend:** Cloudflare Workers (AI proxies, streaming, queues, Durable Objects) + D1 cache + KV
- **Database:** Supabase (PostgreSQL, RLS, edge functions)
- **Payments:** Flutterwave (checkout + webhooks + reconciliation)
- **AI Providers:** Deepgram, AssemblyAI, Gladia, Wit.ai, Groq, Mistral, Gemini, Cohere, Cloudflare AI, OpenRouter
- **Error Tracking:** Sentry
- **Analytics:** PostHog
- **Testing:** Vitest (worker), Jest (mobile)

## Project Structure

```
ekwe/
├── apps/
│   ├── mobile/          # Expo React Native app (Voice Studio + Echo)
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

## Design Philosophy

Ekwe strictly follows a "Pro UI" standard:

- **Typography:** Two typefaces max (`DMSerifDisplay` and `Outfit`) using standard modular scales.
- **Interaction:** Micro-interactions in the 150–300ms range with platform-native easing.
- **Touch Areas:** WCAG-standard touchable surfaces (44×44pt min) with contrast scaling.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
