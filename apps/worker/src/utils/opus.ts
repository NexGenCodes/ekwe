// @ts-expect-error - vendored emscripten glue, no published types
import createLibopusModuleRaw from "../../node_modules/libopus-wasm/dist/generated/libopus.generated.mjs";
import libopusWasm from "./libopus.wasm";
import { logger } from "../logger";

interface LibopusModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _oc_create_decoder(
    sampleRate: number,
    channels: number,
    errorPtr: number,
  ): number;
  _oc_destroy_decoder(handle: number): void;
  _oc_decode(
    handle: number,
    packetPtr: number,
    packetLength: number,
    pcmPtr: number,
    frameSize: number,
    decodeFec: number,
  ): number;
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
}

interface LibopusModuleConfig {
  instantiateWasm: (
    imports: WebAssembly.Imports,
    receiveInstance: (
      instance: WebAssembly.Instance,
      module: WebAssembly.Module,
    ) => void,
  ) => WebAssembly.Exports;
}

const createLibopusModule = createLibopusModuleRaw as (
  config?: LibopusModuleConfig,
) => Promise<LibopusModule>;

const MAX_PACKET_DURATION_MS = 120;

function samplesForDuration(sampleRate: number, durationMs: number): number {
  return (sampleRate / 1000) * durationMs;
}

class WasmOpusDecoder {
  private readonly module: LibopusModule;
  private readonly handle: number;
  private packetPtr = 0;
  private packetBytes = 0;
  private pcmPtr = 0;
  private pcmBytes = 0;
  private freed = false;

  constructor(module: LibopusModule, sampleRate: number, channels: number) {
    this.module = module;
    const errorPtr = module._malloc(4);
    try {
      this.handle = module._oc_create_decoder(sampleRate, channels, errorPtr);
      const error = module.HEAP32[errorPtr >> 2] ?? 0;
      if (!this.handle || error !== 0) {
        throw new Error(`Failed to create opus decoder (error=${error})`);
      }
    } finally {
      module._free(errorPtr);
    }
  }

  decode(packet: Uint8Array, sampleRate: number, channels: number): Int16Array {
    if (this.freed) throw new Error("Opus decoder has been freed");
    if (packet.byteLength === 0) throw new Error("Empty opus packet");

    if (this.packetPtr === 0 || this.packetBytes < packet.byteLength) {
      if (this.packetPtr !== 0) this.module._free(this.packetPtr);
      this.packetPtr = this.module._malloc(packet.byteLength);
      if (this.packetPtr === 0) {
        throw new Error("WASM malloc failed for opus packet");
      }
      this.packetBytes = packet.byteLength;
    }
    this.module.HEAPU8.set(packet, this.packetPtr);

    const frameSize = samplesForDuration(sampleRate, MAX_PACKET_DURATION_MS);
    const pcmBytes = frameSize * channels * 2;
    if (this.pcmPtr === 0 || this.pcmBytes < pcmBytes) {
      if (this.pcmPtr !== 0) this.module._free(this.pcmPtr);
      this.pcmPtr = this.module._malloc(pcmBytes);
      if (this.pcmPtr === 0) {
        throw new Error("WASM malloc failed for pcm output");
      }
      this.pcmBytes = pcmBytes;
    }

    const decodedSamples = this.module._oc_decode(
      this.handle,
      this.packetPtr,
      packet.byteLength,
      this.pcmPtr,
      frameSize,
      0,
    );
    if (decodedSamples < 0) {
      throw new Error(`Opus decode failed (code=${decodedSamples})`);
    }

    return this.module.HEAP16.slice(
      this.pcmPtr >> 1,
      (this.pcmPtr >> 1) + decodedSamples * channels,
    );
  }

  free(): void {
    if (this.freed) return;
    if (this.packetPtr !== 0) this.module._free(this.packetPtr);
    if (this.pcmPtr !== 0) this.module._free(this.pcmPtr);
    this.module._oc_destroy_decoder(this.handle);
    this.freed = true;
  }
}

async function loadLibopusModule(): Promise<LibopusModule> {
  const globalWithProcess = globalThis as unknown as { process?: unknown };
  const processDesc = Object.getOwnPropertyDescriptor(
    globalWithProcess,
    "process",
  );
  try {
    if (processDesc && processDesc.configurable) {
      delete globalWithProcess.process;
    }
    return await createLibopusModule({
      instantiateWasm: (imports, receiveInstance) => {
        receiveInstance(
          new WebAssembly.Instance(libopusWasm, imports),
          libopusWasm,
        );
        return {};
      },
    });
  } finally {
    if (processDesc) {
      if (!("process" in globalWithProcess)) {
        Object.defineProperty(globalWithProcess, "process", processDesc);
      }
    }
  }
}

let decoder: WasmOpusDecoder | null = null;
let decoderReady = false;

export async function initOpusDecoder(): Promise<boolean> {
  if (decoderReady) return true;
  try {
    const module = await loadLibopusModule();
    decoder = new WasmOpusDecoder(module, 16000, 1);
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
  sampleRate: number = 16000,
): Int16Array | null {
  if (!decoderReady || !decoder) {
    logger.warn("[opus] Decoder not initialized");
    return null;
  }

  const packet =
    opusData instanceof ArrayBuffer ? new Uint8Array(opusData) : opusData;

  if (packet.length === 0) {
    logger.warn("[opus] Empty packet");
    return null;
  }

  try {
    return decoder.decode(packet, sampleRate, 1);
  } catch (err) {
    logger.error("[opus] Decode failed", { error: String(err) });
    return null;
  }
}

export function isOpusDecoderReady(): boolean {
  return decoderReady;
}
