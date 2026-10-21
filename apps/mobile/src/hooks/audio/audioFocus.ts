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
  recordingLocked = false;
  recordingFocusToken = null;
};

/**
 * Stops whatever currently owns focus without claiming it. Pre-play callers use
 * this so the upcoming player can claim focus itself; claiming here would make
 * that player pause itself when it starts and abort the start token.
 */
export const pauseActiveAudio = (): void => {
  if (recordingLocked) return;
  const current = owner;
  owner = null;
  if (!current) return;
  try {
    current.pauseNow();
  } catch {
    // ignore — a stale owner may already be released
  }
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
