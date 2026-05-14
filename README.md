# Ekwe

Ekwe is a voice note translation application built specifically for Android and iOS using React Native and Expo. It allows users to capture voice notes (either by recording directly or via sharing external audio files from social/messaging apps like WhatsApp) and seamlessly transcribes and translates them on-device.

## Core Features

- **Direct Recording & Metering:** Real-time pulse and visual metering on the Home Screen during recording using `react-native-audio-api` and Reanimated spring physics.
- **Share Intent Integration:** Ekwe is a registered share target. You can share an audio file from external apps directly to Ekwe for instant transcription. Ekwe also handles text sharing intents.
- **On-Device Processing:** Transcription and translation rely heavily on native APIs ensuring privacy and offline capabilities.
- **Premium UI System:** Built using an elite layout schema (`NativeWind`), complete with custom haptic feedback, OLED-friendly dark mode scaling, and spring-physics animations.
- **History & Settings Persistence:** Uses `react-native-mmkv` and `Legend-State` to manage high-performance global state, retaining translation histories and user preferences efficiently.

## Technology Stack

- **Framework:** [Expo](https://expo.dev) / [React Native](https://reactnative.dev)
- **Styling:** NativeWind (Tailwind CSS for React Native)
- **State Management:** Legend-State + MMKV
- **Animations:** React Native Reanimated
- **Native APIs Integration:**
  - `react-native-audio-api` for complex audio routing, capturing, and metering.
  - `react-native-nitro-share-intent` for native deep-linking and handling intense file buffer sharing safely.
  - `expo-speech-recognition` for speech to text integrations.
- **Error Tracking:** Sentry
- **E2E / Testing:** Jest & Maestro

## Getting Started

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Start the Metro Bundler:**

   ```bash
   npm start
   ```

3. **Run on a Device or Simulator:**

   ```bash
   npm run ios
   # - or -
   npm run android
   ```

## Design Philosophy

Ekwe strictly follows a "Pro UI" standard:

- **Typography:** Uses two typefaces max (`DMSerifDisplay` and `Outfit`) using standard modular scales.
- **Interaction:** Heavy usage of the 150-300ms range for micro-interactions with platform-native easing.
- **Touch Areas:** Ensures WCAG standard compliant touchable surfaces (44x44pt min) and contrast scaling.
