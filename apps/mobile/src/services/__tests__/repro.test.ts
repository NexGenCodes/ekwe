import { describe, it, expect, vi } from "vitest";

vi.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: (string | File)[]) {
      this.uri = parts
        .map((p) => (typeof p === "string" ? p : p.uri))
        .join("/");
    }
    get exists(): boolean {
      return true;
    }
    get size(): number {
      return 1000;
    }
    createUploadTask(
      _url: string,
      _opts: unknown,
    ): { uploadAsync: () => Promise<{ status: number; body: string }> } {
      return {
        uploadAsync: async () => ({
          status: 200,
          body: JSON.stringify({ text: "hello world", language: "en" }),
        }),
      };
    }
  }
  return {
    File,
    UploadType: { MULTIPART: "multipart" },
    Paths: {
      cache: { uri: "file:///mock/cache/" },
      join: (...p: unknown[]) => p.map(String).join("/"),
    },
  };
});

vi.mock("@/services/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
  },
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: () => "https://worker.example",
  mapWorkerError: (code: string) => code,
  isTimeoutError: () => false,
  TimeoutError: class extends Error {},
}));

vi.mock("@/utils/connectivity", () => ({
  isDefinitelyOffline: () => false,
  checkIsOnline: async () => true,
}));

import { batchTranscriber } from "@/services/batchTranscriber";

describe("repro", () => {
  it("transcribes", async () => {
    const res = await batchTranscriber.transcribe(
      {
        uri: "file:///tmp/x.ogg",
        durationMs: 3000,
        meteringData: [-20],
        waveform: [],
      },
      "es",
      undefined,
      () => {},
    );
    console.log(
      "RESULT ok?",
      res.ok,
      "value:",
      (res as { value?: unknown }).value ?? (res as { error?: unknown }).error,
    );
    expect(true).toBe(true);
  });
});
