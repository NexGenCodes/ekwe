import { describe, test, expect, vi } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voice: (_voiceId: string | undefined, _lang: string, gender: string) =>
    gender === "male"
      ? ["en-US-AndrewMultilingualNeural"]
      : ["en-US-AvaMultilingualNeural"],
}));
import {
  buildSpeechCacheKey,
  readSpeechCache,
  resolveEffectiveLang,
  resolveProviderVoices,
  runSpeechSynth,
  writeSpeechCache,
} from "@/services/speech";
import {
  SPEECH_KV_CACHE_MAX_BYTES,
  SPEECH_R2_CACHE_MAX_BYTES,
} from "@/core/budgets";
import { mockEnv, jsonResponse } from "@/__tests__/setup";
import { hashKey } from "@/utils/keys";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { VOICE_PREVIEW_TEXT } from "@ekwe/shared";

function mp3Response(): Response {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new Response(mp3, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

function geminiError(status: number): Response {
  return jsonResponse({ error: { code: status, message: "err" } }, status);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("speech engine (services/speech.ts)", () => {
  describe("buildSpeechCacheKey", () => {
    test("uses voiceId with an explicit gender segment", async () => {
      const hashHi = await hashKey("hi");
      const hashUid = await hashKey("user-1");
      const withVoice = await buildSpeechCacheKey(
        "hi",
        "es",
        "female",
        "studio-male-1",
        "user-1",
      );
      const withoutVoice = await buildSpeechCacheKey(
        "hi",
        "es",
        "female",
        undefined,
        "user-1",
      );
      expect(withVoice).toBe(
        `speech:${hashUid}:studio-male-1:female:free:cache:es:${hashHi}`,
      );
      expect(withoutVoice).toBe(
        `speech:${hashUid}:standard:female:free:cache:es:${hashHi}`,
      );
      expect(withVoice).not.toBe(withoutVoice);
    });

    test("distinguishes a male vs female standard voice", async () => {
      const hashHi = await hashKey("hi");
      const hashUid = await hashKey("user-1");
      const female = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "standard",
        "user-1",
      );
      const male = await buildSpeechCacheKey(
        "hi",
        "en",
        "male",
        "standard",
        "user-1",
      );
      expect(female).toBe(
        `speech:${hashUid}:standard:female:free:cache:en:${hashHi}`,
      );
      expect(male).toBe(
        `speech:${hashUid}:standard:male:free:cache:en:${hashHi}`,
      );
      expect(male).not.toBe(female);
    });

    test("key is deterministically derived from text + lang", async () => {
      const a = await buildSpeechCacheKey(
        "same text",
        "en",
        "female",
        undefined,
        "user-1",
      );
      const b = await buildSpeechCacheKey(
        "same text",
        "en",
        "female",
        undefined,
        "user-1",
      );
      const c = await buildSpeechCacheKey(
        "different",
        "en",
        "female",
        undefined,
        "user-1",
      );
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    test("scopes cache entries per user", async () => {
      const a = await buildSpeechCacheKey(
        "shared phrase",
        "en",
        "female",
        "studio-female-1",
        "user-A",
      );
      const b = await buildSpeechCacheKey(
        "shared phrase",
        "en",
        "female",
        "studio-female-1",
        "user-B",
      );
      expect(a).not.toBe(b);
    });

    test("distinguishes free vs premium tier for the same input", async () => {
      const free = await buildSpeechCacheKey(
        "hi",
        "es",
        "female",
        "standard",
        "user-1",
        "FREE",
      );
      const premium = await buildSpeechCacheKey(
        "hi",
        "es",
        "female",
        "standard",
        "user-1",
        "PREMIUM",
      );
      expect(free).toBe(
        `speech:${await hashKey("user-1")}:standard:female:free:cache:es:${await hashKey("hi")}`,
      );
      expect(premium).toBe(
        `speech:${await hashKey("user-1")}:standard:female:premium:cache:es:${await hashKey("hi")}`,
      );
      expect(free).not.toBe(premium);
    });
  });

  describe("speech KV cache", () => {
    test("write then read round-trips mime/provider/audio", async () => {
      const env = mockEnv();
      const audio = new Uint8Array([1, 2, 3, 4, 5]);
      const key = await buildSpeechCacheKey(
        "hello",
        "es",
        "female",
        undefined,
        "user-1",
      );
      await writeSpeechCache(env, key, {
        mime: "audio/wav",
        provider: "gemini",
        audio,
      });

      const hit = await readSpeechCache(env, key);
      expect(hit).not.toBeNull();
      expect(hit!.mime).toBe("audio/wav");
      expect(hit!.provider).toBe("gemini");
      expect([...hit!.audio]).toEqual([1, 2, 3, 4, 5]);
    });

    test("miss returns null on an empty cache", async () => {
      const env = mockEnv();
      expect(
        await readSpeechCache(env, "speech:female:cache:en:abc"),
      ).toBeNull();
    });

    test("corrupt cached value degrades to null, not a throw", async () => {
      const env = mockEnv();
      await env.EKWE_KV.put(
        "speech:female:cache:en:corrupt",
        new Uint8Array([0x01, 0x02]),
      );
      expect(
        await readSpeechCache(env, "speech:female:cache:en:corrupt"),
      ).toBeNull();
    });

    test("stores audio at the KV cap boundary in KV", async () => {
      const env = mockEnv();
      const audio = new Uint8Array(SPEECH_KV_CACHE_MAX_BYTES);
      const key = await buildSpeechCacheKey(
        "kvcap",
        "en",
        "female",
        undefined,
        "user-1",
      );
      await writeSpeechCache(env, key, {
        mime: "audio/wav",
        provider: "gemini",
        audio,
      });
      expect(env.EKWE_KV.put).toHaveBeenCalled();
      expect(env.SPEECH_CACHE!.put).not.toHaveBeenCalled();
      expect(await readSpeechCache(env, key)).not.toBeNull();
    });
  });

  describe("speech R2 cache", () => {
    test("routes audio above the KV cap to R2 and round-trips", async () => {
      const env = mockEnv();
      const audio = new Uint8Array(SPEECH_KV_CACHE_MAX_BYTES + 1);
      const key = await buildSpeechCacheKey(
        "big",
        "en",
        "female",
        undefined,
        "user-1",
      );
      await writeSpeechCache(env, key, {
        mime: "audio/wav",
        provider: "witai",
        audio,
      });

      expect(env.EKWE_KV.put).not.toHaveBeenCalled();
      expect(env.SPEECH_CACHE!.put).toHaveBeenCalled();

      const hit = await readSpeechCache(env, key);
      expect(hit).not.toBeNull();
      expect(hit!.mime).toBe("audio/wav");
      expect(hit!.provider).toBe("witai");
      expect(hit!.audio.byteLength).toBe(audio.byteLength);
    });

    test("expired R2 object is lazily deleted and misses", async () => {
      const env = mockEnv();
      const key = await buildSpeechCacheKey(
        "old",
        "en",
        "female",
        undefined,
        "user-1",
      );
      const past = Math.floor(Date.now() / 1000) - 60;
      await env.SPEECH_CACHE!.put(key, new Uint8Array([1, 2, 3]), {
        customMetadata: {
          mime: "audio/wav",
          provider: "witai",
          expiresAt: String(past),
        },
      });

      expect(await readSpeechCache(env, key)).toBeNull();
      expect(env.SPEECH_CACHE!.delete).toHaveBeenCalledWith(key);
    });

    test("skips caching audio over the R2 hard byte cap", async () => {
      const env = mockEnv();
      const audio = new Uint8Array(SPEECH_R2_CACHE_MAX_BYTES + 1);
      const key = await buildSpeechCacheKey(
        "huge",
        "en",
        "female",
        undefined,
        "user-1",
      );
      await writeSpeechCache(env, key, {
        mime: "audio/wav",
        provider: "gemini",
        audio,
      });
      expect(env.EKWE_KV.put).not.toHaveBeenCalled();
      expect(env.SPEECH_CACHE!.put).not.toHaveBeenCalled();
      expect(await readSpeechCache(env, key)).toBeNull();
    });
  });

  describe("resolveEffectiveLang", () => {
    test("preview text is pinned to english regardless of requested lang", () => {
      const result = resolveEffectiveLang(VOICE_PREVIEW_TEXT, "fr");
      expect(result.isPreview).toBe(true);
      expect(result.effectiveLang).toBe("en");
    });

    test("non-preview text keeps the requested lang", () => {
      const result = resolveEffectiveLang("anything else", "fr");
      expect(result.isPreview).toBe(false);
      expect(result.effectiveLang).toBe("fr");
    });
  });

  describe("resolveProviderVoices", () => {
    test("deepgram resolves per-language gendered voices", () => {
      expect(
        resolveProviderVoices("deepgram", "es", "female", undefined),
      ).toEqual(["selena"]);
      expect(
        resolveProviderVoices("deepgram", "de", "male", undefined),
      ).toEqual(["julius"]);
      expect(
        resolveProviderVoices("deepgram", "ja", "female", undefined),
      ).toEqual(["izanami"]);
    });

    test("deepgram falls back to the default voice for an unmapped lang", () => {
      expect(
        resolveProviderVoices("deepgram", "zh", "female", undefined),
      ).toEqual(["luna"]);
    });

    test("witai resolves by gender", () => {
      expect(resolveProviderVoices("witai", "en", "male", undefined)).toEqual([
        "wit$Cody",
      ]);
      expect(resolveProviderVoices("witai", "en", "female", undefined)).toEqual(
        ["wit$Remi"],
      );
    });

    test("studio voice ids resolve through the gender-aware matrix", () => {
      expect(
        resolveProviderVoices("gemini", "en", "female", "studio-female-1"),
      ).toEqual(["Aoede", "Kore"]);
      expect(
        resolveProviderVoices("witai", "en", "male", "studio-female-1"),
      ).toEqual(["wit$Charlie"]);
    });

    test("unknown provider returns no voices", () => {
      expect(resolveProviderVoices("nope", "en", "female", undefined)).toEqual(
        [],
      );
    });

    test("edge maps to its own per-language catalog", () => {
      const female = resolveProviderVoices("edge", "en", "female", undefined);
      const male = resolveProviderVoices("edge", "en", "male", undefined);
      expect(female.length).toBeGreaterThan(0);
      expect(male.length).toBeGreaterThan(0);
      expect(male).not.toEqual(female);
    });

    test("standard free voice is gendered: male != female on every free provider", () => {
      const witaiMale = resolveProviderVoices(
        "witai",
        "en",
        "male",
        "standard",
      );
      const witaiFemale = resolveProviderVoices(
        "witai",
        "en",
        "female",
        "standard",
      );
      expect(witaiMale).toEqual(["wit$Cody"]);
      expect(witaiFemale).toEqual(["wit$Remi"]);

      const edgeMale = resolveProviderVoices("edge", "en", "male", "standard");
      const edgeFemale = resolveProviderVoices(
        "edge",
        "en",
        "female",
        "standard",
      );
      expect(edgeMale[0]).toMatch(/Male|Andrew|Brian/);
      expect(edgeFemale[0]).toMatch(/Ava|Emma|Female/);
      expect(edgeMale).not.toEqual(edgeFemale);
    });
  });

  describe("runSpeechSynth", () => {
    test("FREE pipeline takes the first working provider (witai)", async () => {
      const env = mockEnv();
      server.use(http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()));
      const key = await buildSpeechCacheKey(
        "hello",
        "es",
        "female",
        undefined,
        "user-1",
      );
      const result = await runSpeechSynth({
        text: "hello",
        lang: "es",
        gender: "female",
        voiceId: undefined,
        tier: "FREE",
        env,
        signal: new AbortController().signal,
        budgetMs: 20_000,
        cacheKey: key,
      });

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("witai");
      expect(result!.mime).toBe("audio/mpeg");

      const hit = await readSpeechCache(env, key);
      expect(hit?.provider).toBe("witai");
    });

    test("skips a provider flagged down for the day", async () => {
      const env = mockEnv();
      await env.EKWE_KV.put(`speech:down:edge:${today()}`, "1");
      server.use(http.post(PROVIDER_URLS.witaiSynthesize, () => mp3Response()));
      const { tts: edgeTts } = await import("@/providers/edge");

      const result = await runSpeechSynth({
        text: "hello",
        lang: "en",
        gender: "female",
        voiceId: undefined,
        tier: "FREE",
        env,
        signal: new AbortController().signal,
        budgetMs: 20_000,
        cacheKey: null,
      });

      expect(result?.provider).toBe("witai");
      expect(edgeTts).not.toHaveBeenCalled();
    });

    test("marks gemini down for the day on 429, then fails over to deepgram", async () => {
      const env = mockEnv();
      server.use(
        http.post(PROVIDER_URLS.geminiTtsGenerate, () => geminiError(429)),
        http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
      );

      const result = await runSpeechSynth({
        text: "hello",
        lang: "en",
        gender: "female",
        voiceId: "studio-female-1",
        tier: "PREMIUM",
        env,
        signal: new AbortController().signal,
        budgetMs: 20_000,
        cacheKey: null,
      });

      expect(result?.provider).toBe("deepgram");
      expect(await env.EKWE_KV.get(`speech:down:gemini:${today()}`)).toBe("1");
    });

    test("returns null when every provider fails", async () => {
      const env = mockEnv();
      const result = await runSpeechSynth({
        text: "Hallo",
        lang: "de",
        gender: "female",
        voiceId: undefined,
        tier: "PREMIUM",
        env,
        signal: new AbortController().signal,
        budgetMs: 20_000,
        cacheKey: null,
      });

      expect(result).toBeNull();
    });
  });
});
