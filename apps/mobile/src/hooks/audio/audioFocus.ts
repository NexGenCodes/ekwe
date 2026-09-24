interface AudioFocusOwner {
  readonly token: symbol;
  pauseNow: () => void;
}

let owner: AudioFocusOwner | null = null;

export const createAudioFocus = (): {
  claim: (pauseOwnNow: () => void) => void;
  release: () => void;
} => {
  const token = Symbol("audio-focus");

  return {
    claim: (pauseOwnNow: () => void): void => {
      if (recordingLocked) return;
      if (owner && owner.token !== token) {
        try {
          owner.pauseNow();
        } catch {
          // ignore — a stale owner may already be released
        }
      }
      owner = { token, pauseNow: pauseOwnNow };
    },
    release: (): void => {
      if (owner && owner.token === token) owner = null;
    },
  };
};

export const __resetAudioFocus = (): void => {
  owner = null;
  speechFocusHandle = null;
  recordingLocked = false;
  recordingFocusToken = null;
};

let speechFocusHandle: {
  claim: (p: () => void) => void;
  release: () => void;
} | null = null;

export const claimSpeechFocus = (stopSpeech: () => void): void => {
  speechFocusHandle ??= createAudioFocus();
  speechFocusHandle.claim(stopSpeech);
};

export const releaseSpeechFocus = (): void => {
  speechFocusHandle?.release();
};

let recordingFocusToken: symbol | null = null;
let recordingLocked = false;

export const claimRecordingFocus = (pauseOwnNow: () => void): void => {
  if (recordingLocked) return;

  if (owner && owner.token !== recordingFocusToken) {
    try {
      owner.pauseNow();
    } catch {
      /* stale */
    }
  }
  const token = Symbol("recording-focus");
  recordingFocusToken = token;
  owner = {
    token,
    pauseNow: pauseOwnNow,
  };
  recordingLocked = true;
};

export const releaseRecordingFocus = (): void => {
  if (!recordingLocked) return;
  recordingLocked = false;
  if (owner && owner.token === recordingFocusToken) owner = null;
  recordingFocusToken = null;
};
