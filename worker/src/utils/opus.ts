import { createDecoder, type OpusDecoderHandle } from "libopus-wasm";
import { logger } from "../logger";
import { mergePcmFrames } from "./pcm";

let decoder: OpusDecoderHandle | null = null;
let decoderReady = false;

export async function initOpusDecoder(): Promise<boolean> {
  if (decoderReady) return true;
  try {
    decoder = await createDecoder({ sampleRate: 16000, channels: 1 });
    decoderReady = true;
    logger.info("[opus] WASM decoder initialized");
    return true;
  } catch (err) {
    logger.error("[opus] Failed to init WASM decoder", { error: String(err) });
    return false;
  }
}

export function decodeOpusFrame(
  opusData: ArrayBuffer | Uint8Array,
  _sampleRate: number = 16000,
): Int16Array | null {
  if (!decoderReady || !decoder) {
    logger.warn("[opus] Decoder not initialized");
    return null;
  }

  const packet = opusData instanceof ArrayBuffer ? new Uint8Array(opusData) : opusData;

  if (packet.length === 0) {
    logger.warn("[opus] Empty packet");
    return null;
  }

  try {
    return decoder.decode(packet);
  } catch (err) {
    logger.error("[opus] Decode failed", { error: String(err) });
    return null;
  }
}

export function decodeOpusFrames(
  frames: Uint8Array[],
  sampleRate: number = 16000,
): Int16Array | null {
  const decoded: Int16Array[] = [];

  for (const frame of frames) {
    const pcm = decodeOpusFrame(frame, sampleRate);
    if (pcm) decoded.push(pcm);
  }

  if (decoded.length === 0) return null;

  return mergePcmFrames(decoded);
}

export function isOpusDecoderReady(): boolean {
  return decoderReady;
}
