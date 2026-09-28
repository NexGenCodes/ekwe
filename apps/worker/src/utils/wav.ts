/**
 * A 44-byte RIFF/WAVE header for mono 16-bit little-endian PCM, with the data
 * chunk length left at zero because the samples are streamed after it.
 *
 * Streaming needs this rather than `pcmToWav`: a per-flush header would hand
 * the provider several concatenated WAV headers in one body, which only
 * tolerant decoders survive.
 */
export function wavHeader(sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const wav = new Uint8Array(44);
  const dv = new DataView(wav.buffer);

  writeString(dv, 0, "RIFF");
  dv.setUint32(4, 0xffffffff, true); // patched by the receiver, or ignored
  writeString(dv, 8, "WAVE");
  writeString(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeString(dv, 36, "data");
  dv.setUint32(40, 0xffffffff, true);

  return wav;
}

export function pcmToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const header = wavHeader(sampleRate);
  const total = header.length + pcm.byteLength;
  const wav = new Uint8Array(total);
  const dv = new DataView(wav.buffer);
  wav.set(header, 0);

  // Rewrite both length fields now that the size is known.
  dv.setUint32(4, total - 8, true);
  dv.setUint32(40, pcm.byteLength, true);

  wav.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return wav;
}

function writeString(dv: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    dv.setUint8(offset + i, s.charCodeAt(i));
  }
}
