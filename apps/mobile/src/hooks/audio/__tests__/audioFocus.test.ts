import {
  pauseActiveAudio,
  claimRecordingFocus,
  createAudioFocus,
  releaseRecordingFocus,
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

  it("pausing active audio stops a playing player without owning focus", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    pauseActiveAudio();

    const b = createAudioFocus();
    b.claim(() => pauses.push(2));
    expect(pauses).toEqual([1]);
  });

  it("a pre-play pause lets the speech player claim without pausing itself", () => {
    const pauses: string[] = [];
    const source = createAudioFocus();
    source.claim(() => pauses.push("source"));
    pauseActiveAudio();

    const speech = createAudioFocus();
    speech.claim(() => pauses.push("speech"));
    expect(pauses).toEqual(["source"]);
  });

  it("pausing active audio when idle is safe", () => {
    expect(() => pauseActiveAudio()).not.toThrow();
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

  it("blocks new player claims while recording is active", () => {
    const pauses: string[] = [];
    claimRecordingFocus(() => {});
    const a = createAudioFocus();
    a.claim(() => pauses.push("a"));

    expect(pauses).toEqual([]);
  });

  it("pausing active audio is a no-op while recording is active", () => {
    const pauses: string[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push("a"));
    claimRecordingFocus(() => {});
    expect(pauses).toEqual(["a"]);

    pauseActiveAudio();
    expect(pauses).toEqual(["a"]);
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
    pauseActiveAudio();
    const speech = createAudioFocus();
    speech.claim(() => pauses.push("speech"));
    expect(pauses).toEqual(["a"]);
  });
});
