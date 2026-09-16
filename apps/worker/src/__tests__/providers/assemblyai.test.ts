import { describe, test, expect } from "vitest";
import * as assemblyai from "../../providers/assemblyai";
import { mockEnv, makeAudioBlob, jsonResponse, mockSignal } from "../setup";
import { http } from "msw";
import { server } from "../msw/server";
import { PROVIDER_URLS } from "../msw/handlers";

const transcript = () =>
  http.post(PROVIDER_URLS.assemblyaiTranscript, () =>
    jsonResponse({ id: "mock-transcript-id" }),
  );

describe("AssemblyAI provider", () => {
  test("returns result on successful full flow", async () => {
    server.use(
      http.post(PROVIDER_URLS.assemblyaiUpload, () =>
        jsonResponse({ upload_url: "https://mock.audio/url" }),
      ),
      transcript(),
      http.get(`${PROVIDER_URLS.assemblyaiTranscript}/:id`, () =>
        jsonResponse({
          status: "completed",
          text: "Hello world",
          audio_duration: 5.0,
          language_code: "en",
        }),
      ),
    );

    const result = await assemblyai.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
    expect(result!.provider).toBe("assemblyai");
    expect(result!.duration).toBe(5.0);
    expect(result!.language).toBe("en");
  });

  test("returns null on upload error", async () => {
    server.use(
      http.post(PROVIDER_URLS.assemblyaiUpload, () =>
        jsonResponse({ error: "bad key" }, 401),
      ),
    );
    const result = await assemblyai.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on polling timeout", async () => {
    server.use(
      http.post(PROVIDER_URLS.assemblyaiUpload, () =>
        jsonResponse({ upload_url: "https://mock.audio/url" }),
      ),
      transcript(),
      http.get(`${PROVIDER_URLS.assemblyaiTranscript}/:id`, () =>
        jsonResponse({ status: "processing" }),
      ),
    );

    const result = await assemblyai.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv({ ASSEMBLYAI_KEY_2: "" }),
      mockSignal(),
    );
    expect(result).toBeNull();
  }, 15000);
});
