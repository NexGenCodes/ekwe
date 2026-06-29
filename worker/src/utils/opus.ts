import { logger } from "../logger";

let opusDecoderInstance: WebAssembly.Module | null = null;
let decoderReady = false;

// Loads the Opus→PCM WASM decoder.
// The WASM binary should be bound via wrangler.jsonc `wasm_modules`.
export async function initOpusDecoder(wasmModule: WebAssembly.Module): Promise<boolean> {
  if (decoderReady) return true;
  try {
    opusDecoderInstance = wasmModule;
    decoderReady = true;
    logger.info("[opus] WASM decoder initialized");
    return true;
  } catch (err) {
    logger.error("[opus] Failed to init WASM decoder", { error: String(err) });
    return false;
  }
}

/**
 * Decodes a single Opus frame to PCM Int16.
 * Opus frames are typically 20ms = 960 samples at 48kHz.
 * Resamples to 16kHz by taking every 3rd sample (simplified).
 */
export function decodeOpusFrame(
  opusData: ArrayBuffer | Uint8Array,
  _sampleRate: number = 16000,
): Int16Array | null {
  if (!decoderReady || !opusDecoderInstance) {
    logger.warn("[opus] Decoder not initialized");
    return null;
  }

  // For now, this is a stub that returns silence.
  // The actual libopus WASM compilation will provide real decoding.
  // The WASM decoder will:
  // 1. Take an Opus packet
  // 2. Decode to PCM (48kHz float or int16)
  // 3. Resample to 16kHz
  // 4. Return Int16Array

  // TODO: Replace with actual WASM decode call when wasm module is available
  const opusBytes = opusData instanceof ArrayBuffer ? new Uint8Array(opusData) : opusData;
  logger.debug("[opus] decodeOpusFrame stub", { size: opusBytes.length });

  return null;
}

/**
 * Decodes multiple concatenated Opus frames to a single PCM buffer.
 */
export function decodeOpusFrames(
  frames: Uint8Array[],
  sampleRate: number = 16000,
): Int16Array | null {
  const decoded: Int16Array[] = [];

  for (const frame of frames) {
    const pcm = decodeOpusFrame(frame.buffer as ArrayBuffer, sampleRate);
    if (pcm) decoded.push(pcm);
  }

  if (decoded.length === 0) return null;

  const totalLen = decoded.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Int16Array(totalLen);
  let offset = 0;
  for (const arr of decoded) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

export function isOpusDecoderReady(): boolean {
  return decoderReady;
}
