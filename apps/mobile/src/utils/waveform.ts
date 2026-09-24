export const resample = (data: number[], n: number): number[] => {
  if (!data?.length) return [];
  const out: number[] = [];
  let mx = 0.001;
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i / n) * data.length);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / n) * data.length));
    let sum = 0;
    let pk = 0;
    for (let j = lo; j < hi; j++) {
      const v = data[j] ?? 0;
      sum += v;
      if (v > pk) pk = v;
    }
    const blended = (pk + sum / (hi - lo)) / 2;
    if (blended > mx) mx = blended;
    out.push(blended);
  }
  return out.map((v) => Math.min(1, Math.max(0.02, v / mx)));
};

export const normalizeAmplitudes = (
  waveform: number[],
): number[] | undefined => {
  if (!waveform || waveform.length === 0) return undefined;
  const max = Math.max(...waveform);
  if (max <= 0) return undefined;
  return waveform.map((v) => (v / max) * 0.55);
};
