export const ECHO_CONSTANTS = {
  LANGUAGE_GRID: {
    COLUMNS: 3,
    MAX_TOP_LANGS: 5,
    GAP: 12,
    CARD_RADIUS: 20,
  },
  ANIMATION: {
    FADE_DURATION: 300,
  },
  LAYOUT: {
    HANDLE_WIDTH: 40,
    SHEET_PADDING: 20,
  },
};

export const STEP_METADATA = {
  PickLanguage: {
    title: 'Pick Original Language',
    showBadge: true,
  },
  Config: {
    title: 'Confirm & Transcribe',
    showBadge: true,
  },
  Transcribing: {
    title: 'Transcribing...',
    showBadge: false,
  },
  TranscribeResult: {
    title: 'Transcription',
    showBadge: true,
  },
  Translating: {
    title: 'Translating...',
    showBadge: false,
  },
  FullResult: {
    title: 'Results',
    showBadge: true,
  },
};
