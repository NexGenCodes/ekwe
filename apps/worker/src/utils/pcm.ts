export function mergePcmFrames(frames: Int16Array[]): Int16Array {
  if (frames.length === 0) return new Int16Array(0);
  if (frames.length === 1) return frames[0];

  const totalLen = frames.reduce((sum, arr) => sum + arr.length, 0);
  const merged = new Int16Array(totalLen);
  let offset = 0;
  for (const arr of frames) {
    merged.set(arr, offset);
    offset += arr.length;
  }
  return merged;
}
