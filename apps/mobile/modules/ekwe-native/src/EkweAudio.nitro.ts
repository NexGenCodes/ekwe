import { type HybridObject } from "react-native-nitro-modules";

export interface EkweAudio extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  // Callbacks — set from JS, invoked from native capture thread
  // Named for its original role; live capture now delivers PCM16 LE frames.
  onOpusPacket: (pcm: ArrayBuffer, amplitude: number) => void;
  onVadSilence: () => void;

  // Sync amplitude read — called from JS thread at 60fps via rAF
  getAmplitude(): number;
}
