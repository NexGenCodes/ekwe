import { describe, test, expect } from "vitest";
import * as gladia from "@/providers/gladia";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockSignal,
} from "@/__tests__/setup";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

const MOCK_UPLOAD_URL = "https://mock.audio/url";
const MOCK_RESULT_URL = "https://mock.gladia/result";

function fullFlowHandlers() {
  return [
    http.post(PROVIDER_URLS.gladiaUpload, () =>
      jsonResponse({ audio_url: MOCK_UPLOAD_URL }),
    ),
    http.post(PROVIDER_URLS.gladiaTranscription, () =>
      jsonResponse({ result_url: MOCK_RESULT_URL }),
    ),
    http.get(MOCK_RESULT_URL, () =>
      jsonResponse({
        status: "done",
        result: {
          transcription: {
            full_transcript: "Hello world",
            languages: [{ language: "en" }],
          },
        },
      }),
    ),
  ];
}

describe("Gladia provider", () => {
  test("returns result on successful full flow", async () => {
    server.use(...fullFlowHandlers());

    const result = await gladia.stt(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
    expect(result!.provider).toBe("gladia");
  });

  test("returns null on upload error", async () => {
    server.use(
      http.post(PROVIDER_URLS.gladiaUpload, () =>
        jsonResponse({ error: "bad key" }, 401),
      ),
    );
    const result = await gladia.stt(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on polling timeout", async () => {
    server.use(
      http.post(PROVIDER_URLS.gladiaUpload, () =>
        jsonResponse({ audio_url: MOCK_UPLOAD_URL }),
      ),
      http.post(PROVIDER_URLS.gladiaTranscription, () =>
        jsonResponse({ result_url: MOCK_RESULT_URL }),
      ),
      http.get(MOCK_RESULT_URL, () => jsonResponse({ status: "running" })),
    );

    const result = await gladia.stt(
      makeAudioBlob(),
      "en",
      mockEnv({
        GLADIA_KEY_2: "",
        GLADIA_KEY_3: "",
        GLADIA_KEY_4: "",
        GLADIA_KEY_5: "",
      }),
      mockSignal(),
    );
    expect(result).toBeNull();
  }, 15000);
});
