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

export type ResolveAudioOptions = {
  opusOutputPath: string;
  vorbisOutputPath?: string | null;
  maxAudioBytes: number;
  maxDurationMs?: number;
};

export type ResolveAudioResult = {
  success: boolean;
  error: string;
  durationMs: number;
  waveform: number[];
  vorbisSuccess: boolean;
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

  /**
   * Decode-once fan-out: writes the Ogg Opus artifact plus an optional Ogg
   * Vorbis upload copy when `vorbisOutputPath` is non-empty. The result reports
   * `vorbisSuccess`.
   */
  resolveAudio(
    inputPath: string,
    options: ResolveAudioOptions,
  ): Promise<ResolveAudioResult>;

  /** Duration in ms without a full decode, or -1 when it cannot be probed. */
  probeAudioDurationMs(inputPath: string): Promise<number>;
  decodeAudioToWav(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<DecodeToWavResult>;

  /**
   * iOS only. Decodes the source and writes an M4A/AAC-LC playback copy at
   * `outputPath`. Ogg sources bridge through WAV; platform-readable sources
   * decode straight to M4A. Returns true on success.
   */
  createPlaybackCopy?(
    inputPath: string,
    outputPath: string,
    maxAudioBytes: number,
  ): Promise<boolean>;
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
