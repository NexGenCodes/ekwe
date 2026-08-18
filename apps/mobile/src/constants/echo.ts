export const ECHO_CONSTANTS = {
  LANGUAGE_GRID: {
    COLUMNS: 3,
    MAX_TOP_LANGS: 5,
    GAP: 12,
    CARD_ASPECT_RATIO: 0.85,
  },
};

// Brand signature appended to text copied or shared from an Echo result, so a
// pasted translation always carries the Ekwe call-to-action back to the app.
export const ECHO_SHARE_SIGNATURE =
  "\n\n— Shared with Ekwe · Speak, we'll handle the rest";

export const STEP_METADATA = {
  PickLanguage: {
    title: "Pick Original Language",
    showBadge: true,
  },
  Preview: {
    title: "Preview & Transcribe",
    showBadge: true,
  },
  Transcribing: {
    title: "Transcribing…",
    showBadge: false,
  },
  TranscribeResult: {
    title: "Transcription",
    showBadge: true,
  },
  Translating: {
    title: "Translating…",
    showBadge: false,
  },
  FullResult: {
    title: "Results",
    showBadge: true,
  },
  Error: {
    title: "Something went wrong",
    showBadge: true,
  },
};
