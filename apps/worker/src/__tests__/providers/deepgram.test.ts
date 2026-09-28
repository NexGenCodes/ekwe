import { describe, test, expect } from "vitest";
import * as deepgram from "@/providers/deepgram";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

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

    const result = await deepgram.stt(
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

  test("asks for language detection in auto mode", async () => {
    // Regression guard: without detect_language=true Deepgram does not look at
    // the language at all, so detected_language never came back and the auto
    // path silently had no language to report.
    let seenUrl: string | null = null;
    server.use(
      http.post(PROVIDER_URLS.deepgram, ({ request }) => {
        seenUrl = request.url;
        return jsonResponse({
          results: {
            channels: [
              {
                alternatives: [{ transcript: "Bonjour", confidence: 0.99 }],
                detected_language: "fr",
              },
            ],
          },
        });
      }),
    );

    const result = await deepgram.stt(
      makeAudioBlob(),
      "auto",
      mockEnv(),
      mockSignal(),
    );

    expect(seenUrl).toContain("detect_language=true");
    expect(seenUrl).not.toContain("language=fr");
    expect(result?.language).toBe("fr");
  });

  test("sends the requested language and no detection flag when known", async () => {
    let seenUrl: string | null = null;
    server.use(
      http.post(PROVIDER_URLS.deepgram, ({ request }) => {
        seenUrl = request.url;
        return jsonResponse({
          results: {
            channels: [
              { alternatives: [{ transcript: "Bonjour", confidence: 0.99 }] },
            ],
          },
        });
      }),
    );

    const result = await deepgram.stt(
      makeAudioBlob(),
      "fr",
      mockEnv(),
      mockSignal(),
    );

    expect(seenUrl).toContain("language=fr");
    expect(seenUrl).not.toContain("detect_language");
    // Unresolved detection is an absent field, never a guessed default.
    expect(result).not.toHaveProperty("language");
  });

  test("returns null on empty transcript", async () => {
    server.use(
      http.post(PROVIDER_URLS.deepgram, () =>
        jsonResponse({
          results: { channels: [{ alternatives: [{ transcript: "" }] }] },
        }),
      ),
    );
    const result = await deepgram.stt(
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
    const result = await deepgram.stt(
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
    const result = await deepgram.stt(
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
    const result = await deepgram.stt(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
