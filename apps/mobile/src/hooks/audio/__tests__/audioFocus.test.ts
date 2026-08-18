import {
  claimTtsFocus,
  createAudioFocus,
  releaseTtsFocus,
  __resetAudioFocus,
} from "../audioFocus";

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
    // Only A was paused — B owns focus now and is not paused.
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
    // b is the only owner; a already released, so nothing should be paused.
    expect(pauses).toEqual([]);
  });

  it("keeps newly-claimed players paused only while they own focus", () => {
    const pauses: string[] = [];
    const a = createAudioFocus();
    const b = createAudioFocus();
    const c = createAudioFocus();
    a.claim(() => pauses.push("a"));
    b.claim(() => pauses.push("b")); // pauses a
    c.claim(() => pauses.push("c")); // pauses b
    expect(pauses).toEqual(["a", "b"]);
    c.release();
    // a and b's pause fns don't re-fire; release only clears ownership.
    expect(pauses).toEqual(["a", "b"]);
  });

  it("TTS claiming focus pauses a playing native player", () => {
    const pauses: number[] = [];
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    claimTtsFocus(() => pauses.push(99));
    expect(pauses).toEqual([1]);
  });

  it("TTS yielding focus lets a native player claim without pausing it", () => {
    const pauses: number[] = [];
    claimTtsFocus(() => pauses.push(99));
    releaseTtsFocus();
    const a = createAudioFocus();
    a.claim(() => pauses.push(1));
    expect(pauses).toEqual([]);
  });

  it("a native player claiming focus stops speaking TTS", () => {
    const stopped: number[] = [];
    claimTtsFocus(() => stopped.push(9));
    const a = createAudioFocus();
    a.claim(() => {});
    expect(stopped).toEqual([9]);
  });

  it("releasing TTS focus when idle is safe", () => {
    expect(() => releaseTtsFocus()).not.toThrow();
  });
});
