import {
  claimSpeechFocus,
  claimRecordingFocus,
  createAudioFocus,
  releaseRecordingFocus,
  releaseSpeechFocus,
  __resetAudioFocus,
} from "@/hooks/audio/audioFocus";

describe("audioFocus (single-player coordinator)", () => {
  beforeEach(() => {
    __resetAudioFocus();
  });

  it("claims focus without pausing anything when it is the first player", () => {
    const paused: number[] = [];
    const a = createAudioFocus();
    a.claim(() => paused.push(1));
    expect(paused).toEqual([]);
  });

  it("pauses the currently-owning player when a second player claims focus", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    const b = createAudioFocus();
    a.claim(() => pauses.push(1));
    b.claim(() => pauses.push(2));

    expect(pauses).toEqual([1]);
  });

  it("does not pause itself when the same player re-claims focus", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    a.claim(() => pauses.push(1));
    expect(pauses).toEqual([]);
  });

  it("yields focus on release so the next claim pauses nothing", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    a.release();
    const b = createAudioFocus();
    b.claim(() => pauses.push(2));
    expect(pauses).toEqual([]);
  });

  it("a released player no longer owns focus", () => {
    const pauses: string[] = [];
    const a = createAudioFocus();
    const b = createAudioFocus();
    a.claim(() => pauses.push("a"));
    a.release();
    b.claim(() => pauses.push("b"));

    expect(pauses).toEqual([]);
  });

  it("keeps newly-claimed players paused only while they own focus", () => {
    const pauses: string[] = [];
    const a = createAudioFocus();
    const b = createAudioFocus();
    const c = createAudioFocus();
    a.claim(() => pauses.push("a"));
    b.claim(() => pauses.push("b"));
    c.claim(() => pauses.push("c"));
    expect(pauses).toEqual(["a", "b"]);
    c.release();

    expect(pauses).toEqual(["a", "b"]);
  });

  it("speech claiming focus pauses a playing native player", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    claimSpeechFocus(() => pauses.push(99));
    expect(pauses).toEqual([1]);
  });

  it("speech yielding focus lets a native player claim without pausing it", () => {
    const pauses: number[] = [];
    claimSpeechFocus(() => pauses.push(99));
    releaseSpeechFocus();
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    expect(pauses).toEqual([]);
  });

  it("a native player claiming focus stops speaking speech", () => {
    const stopped: number[] = [];
    claimSpeechFocus(() => stopped.push(9));
    const a = createAudioFocus();
    a.claim(() => {});
    expect(stopped).toEqual([9]);
  });

  it("releasing speech focus when idle is safe", () => {
    expect(() => releaseSpeechFocus()).not.toThrow();
  });
});

describe("audioFocus (recording focus)", () => {
  beforeEach(() => {
    __resetAudioFocus();
  });

  it("claims focus and pauses an active player", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    claimRecordingFocus(() => {});
    expect(pauses).toEqual([1]);
  });

  it("claims focus and pauses active speech", () => {
    const stops: number[] = [];
    claimSpeechFocus(() => stops.push(1));
    claimRecordingFocus(() => {});
    expect(stops).toEqual([1]);
  });

  it("blocks new player claims while recording is active", () => {
    const pauses: string[] = [];
    claimRecordingFocus(() => {});
    const a = createAudioFocus();
    a.claim(() => pauses.push("a"));

    expect(pauses).toEqual([]);
  });

  it("blocks new speech claims while recording is active", () => {
    const stops: string[] = [];
    claimRecordingFocus(() => {});
    claimSpeechFocus(() => stops.push("1"));
    expect(stops).toEqual([]);
  });

  it("claimRecordingFocus is idempotent (second call is no-op)", () => {
    const pauses: (number | string)[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    claimRecordingFocus(() => pauses.push("r1"));
    claimRecordingFocus(() => pauses.push("r2"));

    expect(pauses).toEqual([1]);
  });

  it("release lets new players claim again", () => {
    const pauses: string[] = [];
    claimRecordingFocus(() => {});
    releaseRecordingFocus();
    const a = createAudioFocus();
    a.claim(() => pauses.push("a"));
    expect(pauses).toEqual([]);

    const b = createAudioFocus();
    b.claim(() => pauses.push("b"));
    expect(pauses).toEqual(["a"]);
  });

  it("releaseRecordingFocus when idle is safe", () => {
    expect(() => releaseRecordingFocus()).not.toThrow();
  });

  it("recording claiming while a player is active, then releasing, lets speech claim", () => {
    const pauses: string[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push("a"));
    claimRecordingFocus(() => {});
    expect(pauses).toEqual(["a"]);
    releaseRecordingFocus();
    claimSpeechFocus(() => pauses.push("tts"));
    expect(pauses).toEqual(["a"]);
  });
});
