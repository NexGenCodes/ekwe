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

export async function uploadMultipart(
  file: ExpoFile,
  url: string,
  opts: UploadMultipartOptions,
): Promise<{ status: number; body: string }> {
  const retries = 2;
  const timeoutMs =
    opts.timeoutMs ??
    30_000 + Math.ceil((file.size ?? 0) / (1024 * 1024)) * 2000;
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
      return { status: result.status, body: result.body };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      if (error.name === "AbortError" && opts.signal?.aborted) {
        throw error;
      }

      if (!opts.signal?.aborted && controller.signal.aborted) {
        throw new TimeoutError();
      }

      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new Error("Network request failed");
}
