export type FloatingState =
  | 'IDLE'
  | 'BUBBLE_VISIBLE'
  | 'BUBBLE_EXPANDED'
  | 'OVERLAY_ACTIVE'
  | 'HIDDEN_IDLE';

export type BubblePosition = { x: number; y: number } | null;

export type AudioEffectsResult = {
  noiseSuppressor: boolean;
  echoCanceler: boolean;
  gainControl: boolean;
};

export type ExtractWavAndWaveformResult = {
  success: boolean;
  error: string;
  durationMs: number;
  waveform: number[];
};

export type AudioRecordingResult = {
  success: boolean;
  error: string;
  durationMs: number;
  waveform: number[];
};

export type StartRecordingResult = {
  success: boolean;
  error: string;
};
