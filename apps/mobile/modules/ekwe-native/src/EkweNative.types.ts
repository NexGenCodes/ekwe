export type AudioEffectsResult = {
  noiseSuppressor: boolean;
  echoCanceler: boolean;
  gainControl: boolean;
};

export type OpusTranscodeResult = {
  success: boolean;
  error: string;
  durationMs: number;
  waveform: number[];
};

export type DecodeToWavResult = {
  success: boolean;
  error: string;
  durationMs: number;
  waveform: number[];
};

export type RemuxToCafResult = {
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

export type ShareAudioResult = {
  success: boolean;
  error: string;
};

export type OrbStatus = {
  running: boolean;
  hasMediaProjection: boolean;
  foregroundApp: string | null;
  lastPeakAmplitude: number;
};

export type OrbConfig = {
  orbEnabled?: boolean;
  orbAutoArm?: boolean;
};

export type SimpleResult = {
  success: boolean;
  error: string;
};

/**
 * Mirrors the AsyncFunctions the native modules actually register.
 *
 * Every entry here was read off `ios/EkweNativeModule.swift` and
 * `android/.../EkweNativeModule.kt`. The previous version declared methods that
 * exist on neither platform (`decodeToWav`, `encodePcmToOpus`,
 * `transcodeFromMemory`) and omitted ones callers use, which is what broke
 * `tsc` and the share-out tests.
 *
 * iOS and Android disagree on some functions — the orb screen and the echo
 * loader are Android-only — so a capability that is genuinely unavailable is
 * optional rather than declared and then failing at runtime.
 */
export type EkweNativeModuleType = {
  getSystemTheme(): string;
  getInstallerSource(): Promise<string>;

  /** Android only. */
  dismissNativeLoader?(): void;
  /** Android only. */
  dismissEcho?(): void;

  transcodeToOpusWithWaveform(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
    options?: Record<string, unknown>,
  ): Promise<OpusTranscodeResult>;

  /**
   * Same decode → waveform shape as `transcodeToOpusWithWaveform`, but writes
   * Vorbis-in-Ogg instead of Opus-in-Ogg — the only codec Wit.ai parses inside
   * an Ogg container. Always re-encodes, even when the source is already Ogg.
   */
  transcodeToVorbisWithWaveform(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<OpusTranscodeResult>;

  /** Decodes once, writes both Ogg Opus and Ogg Vorbis. */
  transcodeToDualWithWaveform(
    inputPath: string,
    opusOutputPath: string,
    vorbisOutputPath: string,
    maxAudioBytes: number,
  ): Promise<{ opus: OpusTranscodeResult; vorbis: OpusTranscodeResult }>;

  /** Duration in ms without a full decode, or -1 when it cannot be probed. */
  probeAudioDurationMs(inputPath: string): Promise<number>;
  decodeAudioToWav(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<DecodeToWavResult>;
  remuxToCaf(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<RemuxToCafResult>;
  resolveAndTranscodeToOpus(
    uriString: string,
    outputPath: string,
    maxAudioBytes: number,
    options?: { maxDurationMs?: number } | null,
  ): Promise<OpusTranscodeResult>;

  /** Android only; a no-op elsewhere. */
  resolveContentUri?(uriString: string, maxAudioBytes: number): Promise<string>;

  /** iOS only. */
  configureVoiceSession?(): Promise<void>;

  startAudioRecording(
    outputPath: string,
    sampleRate: number,
    isLive: boolean,
  ): Promise<StartRecordingResult>;
  stopAudioRecording(): Promise<AudioRecordingResult>;
  getRecordingAmplitude?(): Promise<number>;

  attachEffects(audioSessionId: number): Promise<AudioEffectsResult>;
  releaseEffects(): Promise<void>;

  shareAudio(
    fileUri: string,
    mimeType?: string | null,
    text?: string | null,
    chooserTitle?: string | null,
  ): Promise<ShareAudioResult>;

  writeSharedFile(fileName: string, content: string): Promise<boolean>;
  deleteFile(uriString: string): Promise<boolean>;

  /** Orb screen, Android only. */
  startOrbCapture?(outputPath: string, isLive: boolean): Promise<SimpleResult>;
  /** Orb screen, Android only. */
  stopOrbCapture?(): Promise<SimpleResult>;
  /** Orb screen, Android only. */
  getOrbPeakAmplitude?(): Promise<number>;
  /** Orb screen, Android only. */
  configureOrb?(config: OrbConfig): Promise<boolean>;
  /** Orb screen, Android only. */
  getOrbStatus?(): Promise<OrbStatus>;
};
