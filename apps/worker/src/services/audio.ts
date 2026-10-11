import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { error } from "@/core/http";
import { getLimits, type Tier } from "@/core/limits";
import {
  guardAudioDuration,
  guardAudioSize,
  guardContentType,
  guardMultipartSize,
  MULTIPART_OVERHEAD,
  readLimitedBody,
} from "@/core/guards";
import { hashBytes } from "@/utils/keys";
import { sniffAudioFormat, CODEC_SNIFF_BYTES } from "@/utils/mime";
import type { AudioCodec } from "@ekwe/shared/providerLimits";

/**
 * `sniffAudioFormat` reads far enough to separate Vorbis from Opus inside a
 * shared Ogg container, which the container sniffer alone could not do.
 */
const SNIFF_BYTES = CODEC_SNIFF_BYTES;

type FormResult = FormData | "too_large" | "invalid";

// Scoped so the body buffer becomes unreachable as soon as this returns.
async function readForm(
  request: Request,
  maxBytes: number,
): Promise<FormResult> {
  const bodyBytes = await readLimitedBody(request, maxBytes);
  if (bodyBytes === null) return "too_large";
  try {
    return await new Response(bodyBytes, {
      headers: {
        "Content-Type":
          request.headers.get("Content-Type") || "multipart/form-data",
      },
    }).formData();
  } catch {
    return "invalid";
  }
}

export interface IngestedAudio {
  /** Re-typed view over the uploaded part. `slice` does not copy the bytes. */
  audio: Blob;
  mimeType: string;
  /**
   * Resolved from the bytes, not the declared type. Wit parses Vorbis-in-Ogg
   * and answers Opus-in-Ogg with silence, so the container alone is not enough
   * to decide whether it can be attempted at all.
   */
  codec: AudioCodec;
  /** SHA-256 of the audio bytes, for cache keys. */
  audioHash: string;
  durationMs: number | undefined;
  form: FormData;
}

export type IngestResult =
  { ok: true; value: IngestedAudio } | { ok: false; response: Response };

/** Parse and validate a multipart audio upload, shared by both audio routes. */
export async function ingestAudioUpload(
  request: Request,
  tier: Tier,
): Promise<IngestResult> {
  const ctGuard = guardContentType(request, "multipart");
  if (!ctGuard.allowed) return { ok: false, response: ctGuard.response };

  const sizePreGuard = guardMultipartSize(request, tier);
  if (!sizePreGuard.allowed)
    return { ok: false, response: sizePreGuard.response };

  const maxBodyBytes = getLimits(tier).maxAudioBytes + MULTIPART_OVERHEAD;
  const parsed = await readForm(request, maxBodyBytes);
  if (parsed === "too_large") {
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.FILE_TOO_LARGE,
        413,
        "Audio file too large. Try a shorter recording.",
      ),
    };
  }
  if (parsed === "invalid") {
    // A malformed multipart body is the client's fault. This used to be a 500,
    // which mobile clients retried.
    logger.warn("[audio] multipart parse failed");
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.EKWE_TRANSCRIPTION_FAIL,
        400,
        "Failed to parse request body.",
      ),
    };
  }
  const form = parsed;

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.MISSING_FILE,
        400,
        "No audio file provided.",
      ),
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT,
        400,
        "Audio file is empty.",
      ),
    };
  }

  const sizeGuard = guardAudioSize(file.size, tier);
  if (!sizeGuard.allowed) return { ok: false, response: sizeGuard.response };

  const durationRaw = form.get("duration") as string | null;
  const durationMs = durationRaw ? Number(durationRaw) : undefined;
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return {
      ok: false,
      response: error(
        WORKER_ERROR_CODES.MISSING_DURATION,
        400,
        "A positive upload duration in milliseconds is required.",
      ),
    };
  }
  const durationGuard = guardAudioDuration(durationMs, tier, file.size);
  if (!durationGuard.allowed)
    return { ok: false, response: durationGuard.response };

  // Hash the file's bytes, not the multipart body: clients send a new boundary
  // each request, so hashing the body would make every cache key unique.
  const fullBuffer = await file.arrayBuffer();
  const audioHash = await hashBytes(fullBuffer);

  const head = new Uint8Array(
    fullBuffer,
    0,
    Math.min(fullBuffer.byteLength, SNIFF_BYTES),
  );
  const sniffed = sniffAudioFormat(head, file.type);

  return {
    ok: true,
    value: {
      audio: file.slice(0, file.size, sniffed.mime),
      mimeType: sniffed.mime,
      codec: sniffed.codec,
      audioHash,
      durationMs,
      form,
    },
  };
}
