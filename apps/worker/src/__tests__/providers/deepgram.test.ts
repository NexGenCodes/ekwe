import { describe, test, expect } from "vitest";
import * as deepgram from "../../providers/deepgram";
import { mockEnv, makeAudioBlob, jsonResponse, mockSignal } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

const listen = () =>
  http.post(PROVIDER_URLS.deepgram, () =>
    jsonResponse({
      results: {
        channels: [
          {
            alternatives: [{ transcript: "Hello world", confidence: 0.99 }],
            detected_language: "en",
          },
        ],
      },
      metadata: { duration: 3.5 },
    }),
  );

describe("Deepgram provider", () => {
  test("returns result on success", async () => {
    server.use(listen());

    const result = await deepgram.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
    expect(result!.provider).toBe("deepgram");
    expect(result!.language).toBe("en");
    expect(result!.duration).toBe(3.5);
  });

  test("returns null on empty transcript", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        jsonResponse({
          results: { channels: [{ alternatives: [{ transcript: "" }] }] },
        }),
      ),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on missing channels", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () => jsonResponse({ results: {} })),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on hallucination", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        jsonResponse({
          results: {
            channels: [
              {
                alternatives: [{ transcript: "Thanks for watching" }],
                detected_language: "en",
              },
            ],
          },
          metadata: { duration: 1.0 },
        }),
      ),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on HTTP 403", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        jsonResponse({ error: "credit exhausted" }, 403),
      ),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
