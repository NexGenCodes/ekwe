import { File as ExpoFile, UploadType } from "expo-file-system";

import { TimeoutError } from "@/utils/http";
import { VOICE_NOTE_EXTENSION_TO_MIME } from "@/utils/fileValidation";

export interface UploadMultipartOptions {
  token: string | null;
  parameters?: Record<string, string>;
  fieldName?: string;
  mimeType?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
}

export function getMimeType(extension: string): string {
  return VOICE_NOTE_EXTENSION_TO_MIME[extension] || "audio/ogg";
}

/**
 * Milliseconds per megabyte allowed for the upload itself, before any
 * processing time.
 *
 * A file that is mostly on the wire and a file already at the worker look the
 * same to a fixed timeout, so the smaller number always aborts one of them.
 */
const UPLOAD_MS_PER_MB = 2_000;

/**
 * Headroom over the worker's own ceiling.
 *
 * The worker caps a transcription at TRANSCRIBE_MAX_BUDGET_MS (90s). A client
 * that gives up before then discards a result the worker had already paid for
 * and charged for; one that waits far longer just holds a dead socket. Kept in
 * step with `transcribeBudgetMs` in the worker's `core/budgets.ts`.
 */
const PROCESSING_HEADROOM_MS = 60_000;

function defaultTimeoutMs(sizeBytes: number | null | undefined): number {
  const mb = Math.ceil((sizeBytes ?? 0) / (1024 * 1024));
  return PROCESSING_HEADROOM_MS + mb * UPLOAD_MS_PER_MB;
}

export async function uploadMultipart(
  file: ExpoFile,
  url: string,
  opts: UploadMultipartOptions,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const retries = 2;
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs(file.size);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);

    try {
      const task = file.createUploadTask(url, {
        httpMethod: "POST",
        uploadType: UploadType.MULTIPART,
        fieldName: opts.fieldName ?? "file",
        mimeType: opts.mimeType ?? "audio/ogg",
        parameters: opts.parameters ?? {},
        headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
        signal: controller.signal,
        onProgress: opts.onProgress
          ? ({
              bytesSent,
              totalBytes,
            }: {
              bytesSent: number;
              totalBytes: number;
            }): void => {
              const fraction = totalBytes > 0 ? bytesSent / totalBytes : 1;
              opts.onProgress!(Math.min(1, Math.max(0, fraction)));
            }
          : undefined,
      });
      const result = await task.uploadAsync();
      return {
        status: result.status,
        body: result.body,
        headers: result.headers ?? {},
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (error.name === "AbortError" && opts.signal?.aborted) {
        throw error;
      }

      if (!opts.signal?.aborted && controller.signal.aborted) {
        throw new TimeoutError();
      }

      // Full jitter. A fixed 1s/2s ladder synchronises every client that
      // dropped at the same instant onto the same provider at the same instant.
      const ceiling = 1000 * 2 ** attempt;
      const wait = Math.random() * ceiling;
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new Error("Network request failed");
}
