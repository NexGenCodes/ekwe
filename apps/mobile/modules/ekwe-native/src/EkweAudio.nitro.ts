import { type HybridObject } from "react-native-nitro-modules";

export interface EkweAudio extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  // Callbacks — set from JS, invoked from native capture thread
  onOpusPacket: (packet: ArrayBuffer, amplitude: number) => void;
  onVadSilence: () => void;

  // Sync amplitude read — called from JS thread at 60fps via rAF
  getAmplitude(): number;
}
