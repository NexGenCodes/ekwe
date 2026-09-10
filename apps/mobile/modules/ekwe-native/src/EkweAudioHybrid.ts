import { NitroModules } from "react-native-nitro-modules";
import type { EkweAudio } from "./EkweAudio.nitro";

/**
 * Singleton HybridObject for the EkweAudio hot path.
 *
 * Provides:
 * - `getAmplitude()`: Synchronous 60fps RMS reads via JSI (replaces `globalThis.ekweNativeGetAmplitude`)
 * - `onOpusPacket`:   Zero-copy ArrayBuffer callback for live Opus packets (replaces Base64 Expo events)
 * - `onVadSilence`:   VAD silence callback (replaces Expo event)
 *
 * Created once on module load — the underlying C++ singleton registers/unregisters
 * itself in its constructor/destructor, so JS code can safely set callbacks at any time.
 */
export const ekweAudio =
  NitroModules.createHybridObject<EkweAudio>("EkweAudio");
