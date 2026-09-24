export function pcmToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.byteLength;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const wav = new Uint8Array(totalSize);
  const dv = new DataView(wav.buffer);

  writeString(dv, 0, "RIFF");
  dv.setUint32(4, totalSize - 8, true);
  writeString(dv, 8, "WAVE");

  writeString(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);

  writeString(dv, 36, "data");
  dv.setUint32(40, dataSize, true);

  const pcmBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  wav.set(pcmBytes, 44);

  return wav;
}

function writeString(dv: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    dv.setUint8(offset + i, str.charCodeAt(i));
  }
}
