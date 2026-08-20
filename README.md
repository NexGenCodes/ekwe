# Ekwe

[![Download APK](https://img.shields.io/badge/Download-APK-blue?style=for-the-badge&logo=android)](https://github.com/NexGenCodes/ekwe/releases/latest/download/app-release.apk)

Ekwe is a voice note translation application built specifically for Android and iOS using React Native and Expo. It allows users to capture voice notes (either by recording directly or via sharing external audio files from social/messaging apps like WhatsApp) and seamlessly transcribes and translates them on-device.

## Core Features

- **Direct Recording & Metering:** Real-time pulse and visual metering on the Home Screen during recording using `expo-audio` and Reanimated spring physics.
- **Share Intent Integration:** Ekwe is a registered share target. You can share an audio file from external apps directly to Ekwe for instant transcription.
- **On-Device Processing:** Transcription and translation rely heavily on native APIs ensuring privacy and offline capabilities.
- **Premium UI System:** Built on a custom design-token system (`src/constants/` + `src/components/ui/`), complete with custom haptic feedback, OLED-friendly dark mode scaling, and spring-physics animations.
- **History & Settings Persistence:** Uses `react-native-mmkv` and `@legendapp/state` to manage high-performance global state, retaining translation histories and user preferences efficiently.

## Technology Stack

- **Framework:** [Expo](https://expo.dev) / [React Native](https://reactnative.dev) (monorepo with Turborepo + pnpm workspaces)
- **Styling:** Custom design-token system (semantic colors, spacing, typography, motion, shadows) with a small `src/components/ui/` primitives layer
- **State Management:** `@legendapp/state` + `react-native-mmkv`
- **Animations:** `react-native-reanimated`
- **Audio:** `expo-audio`
- **Database:** `@op-engineering/op-sqlite`
- **Backend:** Cloudflare Workers + Supabase (PostgreSQL)
- **Payments:** Flutterwave
- **Error Tracking:** Sentry
- **Analytics:** PostHog
- **Testing:** Jest, Vitest (for worker)

## Project Structure

```
ekwe/
├── apps/
│   ├── mobile/          # Expo React Native app
│   └── worker/          # Cloudflare Worker backend
├── packages/
│   └── shared/          # Shared types & utilities
├── scripts/             # Build & token generation scripts
├── supabase/            # Database migrations & seed data
└── turbo.json           # Turborepo config
```

## Download

Download the latest APK directly from GitHub Releases:

**[Latest APK](https://github.com/NexGenCodes/ekwe/releases/latest/download/app-release.apk)**

## Getting Started

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Start the Mobile App:**

   ```bash
   pnpm dev
   ```

3. **Run on a Device or Simulator:**

   ```bash
   pnpm ios
   # - or -
   pnpm android
   ```

## Design Philosophy

Ekwe strictly follows a "Pro UI" standard:

- **Typography:** Uses two typefaces max (`DMSerifDisplay` and `Outfit`) using standard modular scales.
- **Interaction:** Heavy usage of the 150-300ms range for micro-interactions with platform-native easing.
- **Touch Areas:** Ensures WCAG standard compliant touchable surfaces (44x44pt min) and contrast scaling.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
