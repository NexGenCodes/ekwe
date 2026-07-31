import { describe, test, expect } from "vitest";
import * as assemblyai from "../../src/providers/assemblyai";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from "../setup";

describe("AssemblyAI provider", () => {
  afterEach(() => {
    mockFetchReset();
  });

  test("returns result on successful full flow", async () => {
    let step = 0;
    mockFetch(async (url) => {
      step++;
      if (url.includes("api.assemblyai.com/v2/upload")) {
        return jsonResponse({ upload_url: "https://mock.audio/url" });
      }
      if (url.includes("api.assemblyai.com/v2/transcript")) {
        if (step === 2) return jsonResponse({ id: "mock-transcript-id" });
        return jsonResponse({
          status: "completed",
          text: "Hello world",
          audio_duration: 5.0,
          language_code: "en",
        });
      }
      return jsonResponse({}, 404);
    });

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
    mockFetch(async (url) => {
      if (url.includes("api.assemblyai.com/v2/upload"))
        return jsonResponse({ error: "bad key" }, 401);
      return jsonResponse({}, 404);
    });
    const result = await assemblyai.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on polling timeout", async () => {
    mockFetch(async (url) => {
      if (url.includes("api.assemblyai.com/v2/upload"))
        return jsonResponse({ upload_url: "https://mock.audio/url" });
      if (
        String(url).includes("api.assemblyai.com/v2/transcript") &&
        !String(url).includes("/v2/transcript/")
      )
        return jsonResponse({ id: "mock-id" });
      if (String(url).includes("/v2/transcript/"))
        return jsonResponse({ status: "processing" });
      return jsonResponse({}, 404);
    });

    const result = await assemblyai.transcribe(
      makeAudioBlob(),
      "en",
      mockEnv({ ASSEMBLYAI_KEY_2: "" }),
      mockSignal(),
    );
    expect(result).toBeNull();
  }, 15000);
});
