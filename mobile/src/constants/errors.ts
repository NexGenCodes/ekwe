export enum EkweError {
  NO_SPEECH = "EKWE_NO_SPEECH",
  TOO_SHORT = "EKWE_TOO_SHORT",
  LOW_VOLUME = "EKWE_LOW_VOLUME",
  INTERRUPTED = "EKWE_INTERRUPTED",
  BAD_FORMAT = "EKWE_BAD_FORMAT",
  PROCESSOR_FAIL = "EKWE_PROCESSOR_FAIL",
  EMPTY_TRANSCRIPT = "EKWE_EMPTY_TRANSCRIPT",
  NETWORK_LOST = "EKWE_NETWORK_LOST",
  LANG_UNSUPPORTED = "EKWE_LANG_UNSUPPORTED",
  LOW_QUALITY = "EKWE_LOW_QUALITY",
  SHARE_COPY_FAIL = "EKWE_SHARE_COPY_FAIL",
  PERMISSION_MIC = "EKWE_PERMISSION_MIC",
  PERMISSION_OVERLAY = "EKWE_PERMISSION_OVERLAY",
  SESSION_INTERRUPTED = "EKWE_SESSION_INTERRUPTED",
  TRANSCRIPTION_FAIL = "EKWE_TRANSCRIPTION_FAIL",
  TRANSCRIBE_TIMEOUT = "EKWE_TRANSCRIBE_TIMEOUT",
  TRANSLATION_FAIL = "EKWE_TRANSLATION_FAIL",
  RATE_LIMITED = "EKWE_RATE_LIMITED",
  ALL_PROVIDERS_FAIL = "EKWE_ALL_PROVIDERS_FAIL",
  AUDIO_RECORD_FAIL = "EKWE_AUDIO_RECORD_FAIL",
  AUDIO_EMPTY = "EKWE_AUDIO_EMPTY",
  FILE_TOO_LARGE = "EKWE_FILE_TOO_LARGE",
  TTS_FAIL = "EKWE_TTS_FAIL",
  SERVER_ERROR = "EKWE_SERVER_ERROR",
  REQUEST_CANCELLED = "EKWE_REQUEST_CANCELLED",
}

export const ErrorMessages: Record<EkweError, string> = {
  [EkweError.NO_SPEECH]:
    "No speech found. Make sure the voice note is playing.",
  [EkweError.TOO_SHORT]:
    "Recording too short. Hold the bubble while the voice note plays.",
  [EkweError.LOW_VOLUME]:
    "Volume too low. Speaker volume has been raised — try again.",
  [EkweError.INTERRUPTED]:
    "Recording stopped by an incoming call. Tap the bubble to retry.",
  [EkweError.BAD_FORMAT]: "This audio format is not supported.",
  [EkweError.PROCESSOR_FAIL]: "Audio processing failed. Please try again.",
  [EkweError.EMPTY_TRANSCRIPT]:
    "Could not transcribe this audio. Try again in a quieter place.",
  [EkweError.NETWORK_LOST]:
    "No internet connection. Ekwe needs internet to transcribe.",
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
  [EkweError.RATE_LIMITED]: "Service is busy. Trying another provider.",
  [EkweError.ALL_PROVIDERS_FAIL]:
    "Transcription is busy right now. Try again in a moment.",
  [EkweError.AUDIO_RECORD_FAIL]: "Could not start recording. Please try again.",
  [EkweError.AUDIO_EMPTY]:
    "No audio was captured. Make sure the voice note is audible.",
  [EkweError.FILE_TOO_LARGE]:
    "This file is too large to process. Maximum size is 25MB.",
  [EkweError.TTS_FAIL]: "Text-to-speech failed. Please try again.",
  [EkweError.SERVER_ERROR]: "Server error. Please try again.",
  [EkweError.REQUEST_CANCELLED]: "Request was cancelled.",
};
