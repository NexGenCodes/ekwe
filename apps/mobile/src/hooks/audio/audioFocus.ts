/**
 * App-level "single audio focus" coordinator.
 *
 * The app can create more than one native player at a time (e.g. the home
 * dictation preview and the Echo share flow may both be alive because the share
 * route stacks on top of the running app). Both set `interruptionMode:
 * "doNotMix"` on play, so two simultaneously-playing players would fight over
 * audio focus on Android and the AVAudioSession on iOS.
 *
 * This is a tiny focus bus: when a player starts, it first pauses whatever other
 * player currently owns focus, then claims it. Pausing/releasing yields the
 * focus. It is intentionally framework-agnostic so it can be unit-tested.
 */
interface AudioFocusOwner {
  readonly token: symbol;
  pauseNow: () => void;
}

let owner: AudioFocusOwner | null = null;

/**
 * Returns a symbol identifying this player instance, plus the reference-counted
 * claim/release handlers. Prefer creating the token once per player lifetime.
 */
export const createAudioFocus = (): {
  claim: (pauseOwnNow: () => void) => void;
  release: () => void;
} => {
  const token = Symbol("audio-focus");

  return {
    claim: (pauseOwnNow: () => void): void => {
      if (recordingLocked) return; // recording in progress — block new claims
      if (owner && owner.token !== token) {
        // Silently stop whatever else is playing before we start.
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

/** Test-only reset. */
export const __resetAudioFocus = (): void => {
  owner = null;
  ttsFocusHandle = null;
  recordingLocked = false;
  recordingFocusToken = null;
};

/**
 * Text-to-speech is registered on the same focus bus as native players, so a
 * spoken utterance and a playing audio file never run at the same time (both
 * would otherwise claim the audio session). Claim before `Speech.speak`,
 * release on start/done/stopped/error/unmount.
 *
 * Because expo-speech is intentionally not imported here (keeps this module
 * pure + unit-testable), each site supplies its own "stop speech now" callback.
 */
let ttsFocusHandle: {
  claim: (p: () => void) => void;
  release: () => void;
} | null = null;

export const claimTtsFocus = (stopSpeech: () => void): void => {
  ttsFocusHandle ??= createAudioFocus();
  ttsFocusHandle.claim(stopSpeech);
};

export const releaseTtsFocus = (): void => {
  ttsFocusHandle?.release();
};

/**
 * Recording is the most privileged focus owner. While a voice-note is being
 * recorded we *block* new player/TTS claims entirely (the bus early-returns)
 * so the user never hears their own playback leaking into the mic, or a TTS
 * utterance stealing the audio session mid-recording.
 *
 * `claimRecordingFocus` pauses whatever is currently playing (player or TTS),
 * then locks the bus. `releaseRecordingFocus` clears the lock and lets the
 * next claim through. Both are safe to call from any teardown path because
 * the guard checks are idempotent.
 */
let recordingFocusToken: symbol | null = null;
let recordingLocked = false;

export const claimRecordingFocus = (pauseOwnNow: () => void): void => {
  if (recordingLocked) return; // already recording — idempotent
  // If another owner exists (player or TTS), pause it first.
  if (owner && owner.token !== recordingFocusToken) {
    try { owner.pauseNow(); } catch { /* stale */ }
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
