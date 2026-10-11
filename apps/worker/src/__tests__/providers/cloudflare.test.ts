import { describe, test, expect } from "vitest";
import * as cloudflare from "@/providers/cloudflare";
import { mockEnv, makeAudioBlob, mockSignal } from "@/__tests__/setup";

describe("Cloudflare provider", () => {
  describe("transcribe", () => {
    test("returns result on success", async () => {
      const env = mockEnv();
      const result = await cloudflare.stt(
        makeAudioBlob(),
        "en",
        env,
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.text).toBe("mock whisper transcription");
      expect(result!.provider).toBe("cloudflare");
    });

    test("returns null when AI returns empty text", async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({ text: "" })) as unknown as typeof env.AI.run;
      const result = await cloudflare.stt(
        makeAudioBlob(),
        "en",
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on hallucination", async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({
        text: "Thanks for watching",
      })) as unknown as typeof env.AI.run;
      const result = await cloudflare.stt(
        makeAudioBlob(),
        "en",
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on AI error", async () => {
      const env = mockEnv();
      env.AI.run = async () => {
        throw new Error("AI model error");
      };
      const result = await cloudflare.stt(
        makeAudioBlob(),
        "en",
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("uses the whisper-large-v3-turbo model", async () => {
      const env = mockEnv();
      await cloudflare.stt(makeAudioBlob(), "en", env, mockSignal());
      expect(env.AI.run).toHaveBeenCalledWith(
        "@cf/openai/whisper-large-v3-turbo",
        expect.anything(),
      );
    });

    test("sends audio as a base64 string", async () => {
      // The Whisper binding rejects the { body, contentType } object
      // form — it JSON-serializes ArrayBuffer as an object, and the
      // API expects /audio to be a base64 string.
      const env = mockEnv();
      const blob = makeAudioBlob();
      await cloudflare.stt(blob, "en", env, mockSignal());

      const [, input] = (
        env.AI.run as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls[0];
      const audio = (input as { audio: unknown }).audio;
      expect(typeof audio).toBe("string");
    });

    test("passes the requested language through", async () => {
      const env = mockEnv();
      await cloudflare.stt(makeAudioBlob(), "fr", env, mockSignal());
      const [, input] = (
        env.AI.run as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls[0];
      expect((input as { language?: string }).language).toBe("fr");
    });

    test("omits the language field in auto mode and reports the detection", async () => {
      const env = mockEnv();
      let seenInput: Record<string, unknown> | undefined;
      env.AI.run = (async (_model: string, input: Record<string, unknown>) => {
        seenInput = input;
        return {
          text: "Bonjour le monde",
          transcription_info: { language: "fr", language_probability: 0.98 },
        };
      }) as unknown as typeof env.AI.run;

      const result = await cloudflare.stt(
        makeAudioBlob(),
        "auto",
        env,
        mockSignal(),
      );

      expect(seenInput?.language).toBeUndefined();
      expect(result?.language).toBe("fr");
    });

    test("omits the language field when auto detection resolves to nothing", async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({
        text: "1234",
        transcription_info: { language: "" },
      })) as unknown as typeof env.AI.run;

      const result = await cloudflare.stt(
        makeAudioBlob(),
        "auto",
        env,
        mockSignal(),
      );

      expect(result?.text).toBe("1234");
      expect(result).not.toHaveProperty("language");
    });
  });

  describe("translate", () => {
    test("returns translation on success", async () => {
      const env = mockEnv();
      const result = await cloudflare.ttt(
        "Hello world",
        {
          targetLang: "es",
          sourceLang: "en",
          transliteration: false,
        },
        env,
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.translation).toBe("translated text");
      expect(result!.provider).toBe("cloudflare");
    });

    test("returns null on empty response", async () => {
      const env = mockEnv();
      env.AI.run = (async () => ({})) as unknown as typeof env.AI.run;
      const result = await cloudflare.ttt(
        "Hello",
        {
          targetLang: "es",
          sourceLang: "en",
          transliteration: false,
        },
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test("returns null on error", async () => {
      const env = mockEnv();
      env.AI.run = async () => {
        throw new Error("model error");
      };
      const result = await cloudflare.ttt(
        "Hello",
        {
          targetLang: "es",
          sourceLang: "en",
          transliteration: false,
        },
        env,
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });
});
