import { describe, test, expect } from "vitest";
import * as witai from "../../src/providers/witai";
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from "../setup";

describe("Wit.ai provider", () => {
  afterEach(() => {
    mockFetchReset();
  });

  test("returns result on success", async () => {
    mockFetch(async () => {
      const stream = JSON.stringify({ text: "Hello world", is_final: true });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Hello world");
  });

  test("returns null when no key for language", async () => {
    const env = mockEnv({});
    const result = await witai.transcribe(
      makeAudioBlob(),
      "yo",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("returns null on HTTP error", async () => {
    mockFetch(async () => jsonResponse({ error: "bad auth" }, 401));
    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test("handles multi-chunk streaming response", async () => {
    mockFetch(async () => {
      const chunks = [
        JSON.stringify({ text: "Hello", is_final: false }),
        JSON.stringify({ text: "Hello world", is_final: true }),
      ].join("\n");
      return new Response(chunks, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result!.text).toBe("Hello world");
  });

  test("handles BOM prefix", async () => {
    mockFetch(async () => {
      return new Response(
        "\uFEFF" + JSON.stringify({ text: "Hello world", is_final: true }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    const env = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });
    const result = await witai.transcribe(
      makeAudioBlob(),
      "en",
      env,
      mockSignal(),
    );
    expect(result!.text).toBe("Hello world");
  });
});
