// Application-specific types for the EkweNative module

export type BubblePosition = { x: number; y: number } | null;

export type AudioEffectsResult = {
  noiseSuppressor: boolean;
  echoCanceler: boolean;
  gainControl: boolean;
};
