import { FREE_LIMITS, PREMIUM_LIMITS, WORKER_ERROR_CODES } from "@ekwe/shared";

const FREE_MAX_MIN = Math.round(FREE_LIMITS.dictationDurationMs / 60000);
const PRO_MAX_MIN = Math.round(PREMIUM_LIMITS.dictationDurationMs / 60000);
const FREE_MAX_MB = Math.round(FREE_LIMITS.maxAudioBytes / 1_048_576);
const PRO_MAX_MB = Math.round(PREMIUM_LIMITS.maxAudioBytes / 1_048_576);

export const EkweError = {
  NO_SPEECH: "EKWE_NO_SPEECH",
  TOO_SHORT: "EKWE_TOO_SHORT",
  LOW_VOLUME: "EKWE_LOW_VOLUME",
  INTERRUPTED: "EKWE_INTERRUPTED",
  BAD_FORMAT: "EKWE_BAD_FORMAT",
  PROCESSOR_FAIL: "EKWE_PROCESSOR_FAIL",
  EMPTY_TRANSCRIPT: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT,
  NETWORK_LOST: "EKWE_NETWORK_LOST",
  LANG_UNSUPPORTED: "EKWE_LANG_UNSUPPORTED",
  LOW_QUALITY: "EKWE_LOW_QUALITY",
  SHARE_COPY_FAIL: "EKWE_SHARE_COPY_FAIL",
  PERMISSION_MIC: "EKWE_PERMISSION_MIC",
  PERMISSION_OVERLAY: "EKWE_PERMISSION_OVERLAY",
  SESSION_INTERRUPTED: "EKWE_SESSION_INTERRUPTED",
  TRANSCRIPTION_FAIL: WORKER_ERROR_CODES.EKWE_TRANSCRIPTION_FAIL,
  TRANSCRIBE_TIMEOUT: "EKWE_TRANSCRIBE_TIMEOUT",
  TRANSLATION_FAIL: "EKWE_TRANSLATION_FAIL",
  RATE_LIMITED: WORKER_ERROR_CODES.EKWE_RATE_LIMIT,
  QUOTA_EXCEEDED: WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED,
  ALL_PROVIDERS_FAIL: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
  AUDIO_RECORD_FAIL: "EKWE_AUDIO_RECORD_FAIL",
  AUDIO_EMPTY: "EKWE_AUDIO_EMPTY",
  FILE_TOO_LARGE: WORKER_ERROR_CODES.FILE_TOO_LARGE,
  AUDIO_TOO_LONG: WORKER_ERROR_CODES.AUDIO_TOO_LONG,
  TEXT_TOO_LONG: WORKER_ERROR_CODES.TEXT_TOO_LONG,
  SPEECH_FAIL: "EKWE_SPEECH_FAIL",
  /** A free account asked for a Pro voice. */
  PREMIUM_REQUIRED: WORKER_ERROR_CODES.PREMIUM_FEATURE_REQUIRED,
  /** Every speech provider was down or rate limited. Worth a retry later. */
  SPEECH_UNAVAILABLE: WORKER_ERROR_CODES.SPEECH_UNAVAILABLE,
  SPEECH_TIMEOUT: "EKWE_SPEECH_TIMEOUT",
  SERVER_ERROR: WORKER_ERROR_CODES.EKWE_SERVER_ERROR,
  REQUEST_CANCELLED: "EKWE_REQUEST_CANCELLED",
} as const;

export type EkweError = (typeof EkweError)[keyof typeof EkweError];

export const ErrorMessages: Record<EkweError, string> = {
  [EkweError.NO_SPEECH]:
    "No speech found. Make sure the voice note is playing.",
  [EkweError.TOO_SHORT]:
    "Recording too short. Hold the bubble while the voice note plays.",
  [EkweError.LOW_VOLUME]:
    "Volume too low. Speaker volume has been raised — try again.",
  [EkweError.INTERRUPTED]: "Recording was interrupted. Please try again.",
  [EkweError.BAD_FORMAT]: "This audio format is not supported.",
  [EkweError.PROCESSOR_FAIL]: "Audio processing failed. Please try again.",
  [EkweError.EMPTY_TRANSCRIPT]:
    "Could not transcribe this audio. Try again in a quieter place.",
  [EkweError.NETWORK_LOST]:
    "No internet connection. Check your connection and try again.",
  [EkweError.LANG_UNSUPPORTED]: "This language is not supported yet.",
  [EkweError.LOW_QUALITY]: "Audio quality was low. Result may be inaccurate.",
  [EkweError.SHARE_COPY_FAIL]: "Could not read the shared audio file.",
  [EkweError.PERMISSION_MIC]:
    "Microphone access is required. Enable it in Settings.",
  [EkweError.PERMISSION_OVERLAY]:
    "Display over other apps is required. Enable it in Settings.",
  [EkweError.SESSION_INTERRUPTED]:
    "Session interrupted. Your partial transcript was saved.",
  [EkweError.TRANSCRIPTION_FAIL]: "Transcription failed. Please try again.",
  [EkweError.TRANSCRIBE_TIMEOUT]:
    "Request timed out. The audio might be too complex or long.",
  [EkweError.TRANSLATION_FAIL]: "Translation failed. Please try again.",
  [EkweError.RATE_LIMITED]: "Please wait a moment before trying again.",
  [EkweError.QUOTA_EXCEEDED]:
    "You've reached today's limit. It resets at midnight.",
  [EkweError.ALL_PROVIDERS_FAIL]:
    "Transcription is busy right now. Try again in a moment.",
  [EkweError.AUDIO_RECORD_FAIL]: "Could not start recording. Please try again.",
  [EkweError.AUDIO_EMPTY]:
    "No audio was captured. Make sure the voice note is audible.",
  [EkweError.FILE_TOO_LARGE]: `This file is too large for your plan. Free: ${FREE_MAX_MB}MB · Pro: ${PRO_MAX_MB}MB.`,
  [EkweError.AUDIO_TOO_LONG]: `This audio is too long for your plan. Free: ${FREE_MAX_MIN} min per file · Pro: ${PRO_MAX_MIN} min.`,
  [EkweError.TEXT_TOO_LONG]:
    "This text is too long for your plan. Try a shorter passage.",
  [EkweError.SPEECH_FAIL]: "Speech failed. Please try again.",
  [EkweError.PREMIUM_REQUIRED]: "This voice requires Ekwe Pro.",
  [EkweError.SPEECH_UNAVAILABLE]:
    "Voice is temporarily unavailable. Please try again shortly.",
  [EkweError.SPEECH_TIMEOUT]:
    "Voice took too long to respond. Try a shorter passage.",
  [EkweError.SERVER_ERROR]: "Server error. Please try again.",
  [EkweError.REQUEST_CANCELLED]: "Request was cancelled.",
};
