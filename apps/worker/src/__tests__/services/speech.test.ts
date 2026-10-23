import { describe, test, expect, vi } from "vitest";

vi.mock("@/providers/edge", () => ({
  tts: vi.fn(async () => ({ result: null, status: null })),
  voices: (gender: string | undefined) =>
    gender === "male"
      ? ["en-US-AndrewMultilingualNeural"]
      : ["en-US-AvaMultilingualNeural"],
}));
import {
  buildSpeechCacheKey,
  purgeExpiredSpeechCache,
  readSpeechCache,
  runSpeechSynth,
  writeSpeechCache,
} from "@/services/speech";
import {
  pipelineTierForSlot,
  resolveExecutionTier,
  resolveProviderVoices,
  resolveVoicePool,
} from "@/core/voices";
import {
  SPEECH_KV_CACHE_MAX_BYTES,
  SPEECH_PER_PROVIDER_MS,
  SPEECH_PIPELINE_TOTAL_MS,
  SPEECH_R2_CACHE_MAX_BYTES,
} from "@/core/budgets";
import { mockEnv, jsonResponse } from "@/__tests__/setup";
import { hashKey } from "@/utils/keys";
import { http } from "msw";
import type { HttpResponseResolver } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { getVoiceSlot } from "@ekwe/shared";

/** Past the provider floor — see the note in routes/synthesize.test.ts. */
function mp3Response(): Response {
  return new Response(new Uint8Array(4_096), {
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
        "studio",
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
        `speech:${hashUid}:studio:female:free:cache:es:${hashHi}`,
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
        "studio",
        "user-A",
      );
      const b = await buildSpeechCacheKey(
        "shared phrase",
        "en",
        "female",
        "studio",
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

    test("shared scope drops the per-user partition", async () => {
      const hashText = await hashKey("hi");
      const a = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "studio",
        "user-A",
        "PREMIUM",
        "shared",
      );
      const b = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "studio",
        "user-B",
        "PREMIUM",
        "shared",
      );
      expect(a).toBe(
        `speech:shared:studio:female:premium:cache:en:${hashText}`,
      );
      // Two different users must land on the same entry, which is the whole
      // point: the clip is identical for both of them.
      expect(a).toBe(b);
      // And it must not leak the user hash into the key.
      expect(a).not.toContain(await hashKey("user-A"));
    });

    test("shared scope still separates tier, gender and slot", async () => {
      const base = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "studio",
        "user-1",
        "FREE",
        "shared",
      );
      const premium = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "studio",
        "user-1",
        "PREMIUM",
        "shared",
      );
      const male = await buildSpeechCacheKey(
        "hi",
        "en",
        "male",
        "studio",
        "user-1",
        "FREE",
        "shared",
      );
      const warm = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "studio-2",
        "user-1",
        "FREE",
        "shared",
      );
      // A free request must never be served a premium-cached clip.
      expect(base).not.toBe(premium);
      expect(base).not.toBe(male);
      expect(base).not.toBe(warm);
    });

    test("the default scope stays per-user", async () => {
      const a = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "standard",
        "user-A",
      );
      const b = await buildSpeechCacheKey(
        "hi",
        "en",
        "female",
        "standard",
        "user-B",
      );
      expect(a).toContain(await hashKey("user-A"));
      expect(a).not.toBe(b);
      expect(a).not.toContain("shared");
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

  describe("purgeExpiredSpeechCache", () => {
    test("deletes expired and metadata-less objects, keeps fresh ones", async () => {
      const env = mockEnv();
      const now = Math.floor(Date.now() / 1000);
      vi.mocked(env.SPEECH_CACHE!.list).mockResolvedValue({
        objects: [
          {
            key: "speech:fresh",
            customMetadata: { expiresAt: String(now + 600) },
          },
          {
            key: "speech:expired",
            customMetadata: { expiresAt: String(now - 60) },
          },
          { key: "speech:legacy", customMetadata: {} },
        ],
        truncated: false,
      } as never);

      expect(await purgeExpiredSpeechCache(env)).toBe(2);
      expect(env.SPEECH_CACHE!.delete).toHaveBeenCalledWith("speech:expired");
      expect(env.SPEECH_CACHE!.delete).toHaveBeenCalledWith("speech:legacy");
      expect(env.SPEECH_CACHE!.delete).not.toHaveBeenCalledWith("speech:fresh");
    });

    test("follows the cursor across pages", async () => {
      const env = mockEnv();
      const now = Math.floor(Date.now() / 1000);
      vi.mocked(env.SPEECH_CACHE!.list)
        .mockResolvedValueOnce({
          objects: [
            {
              key: "speech:a",
              customMetadata: { expiresAt: String(now - 10) },
            },
          ],
          truncated: true,
          cursor: "page-2",
        } as never)
        .mockResolvedValueOnce({
          objects: [
            {
              key: "speech:b",
              customMetadata: { expiresAt: String(now + 10) },
            },
          ],
          truncated: false,
        } as never);

      expect(await purgeExpiredSpeechCache(env)).toBe(1);
      expect(env.SPEECH_CACHE!.list).toHaveBeenNthCalledWith(2, {
        cursor: "page-2",
      });
      expect(env.SPEECH_CACHE!.delete).toHaveBeenCalledWith("speech:a");
      expect(env.SPEECH_CACHE!.delete).not.toHaveBeenCalledWith("speech:b");
    });

    test("is a no-op without an R2 binding", async () => {
      const env = { ...mockEnv(), SPEECH_CACHE: undefined } as unknown as Env;
      expect(await purgeExpiredSpeechCache(env)).toBe(0);
    });
  });

  describe("resolveProviderVoices", () => {
    test("deepgram resolves per-language gendered voices", () => {
      expect(resolveProviderVoices("deepgram", "female", "es")).toEqual([
        "diana",
        "estrella",
        "selena",
      ]);
      expect(resolveProviderVoices("deepgram", "male", "de")).toEqual([
        "fabian",
        "julius",
      ]);
      expect(resolveProviderVoices("deepgram", "female", "ja")).toEqual([
        "izanami",
        "ama",
        "uzume",
      ]);
    });

    test("witai resolves by gender", () => {
      expect(resolveProviderVoices("witai", "male", "en")).toEqual([
        "wit$Cody",
        "wit$Cooper",
      ]);
      expect(resolveProviderVoices("witai", "female", "en")).toEqual([
        "wit$Remi",
        "wit$Rebecca",
      ]);
    });

    test("an unset gender yields the provider neutral default", () => {
      expect(resolveProviderVoices("gemini", undefined, "en")).toEqual([
        "Kore",
      ]);
      expect(resolveProviderVoices("witai", undefined, "en")).toEqual([
        "wit$Remi",
      ]);
      expect(
        resolveProviderVoices("edge", undefined, "en").length,
      ).toBeGreaterThan(0);
    });

    test("no provider falls through to the other gender", () => {
      for (const provider of ["gemini", "deepgram", "witai", "edge"]) {
        const male = resolveProviderVoices(provider, "male", "en");
        const female = resolveProviderVoices(provider, "female", "en");
        expect(male.length).toBeGreaterThan(0);
        expect(female.length).toBeGreaterThan(0);
        expect(male).not.toEqual(female);
      }
    });

    test("unknown provider returns no voices", () => {
      expect(resolveProviderVoices("nope", "female", "en")).toEqual([]);
    });

    test("edge maps to its own per-language catalog", () => {
      const female = resolveProviderVoices("edge", "female", "en");
      const male = resolveProviderVoices("edge", "male", "en");
      expect(female.length).toBeGreaterThan(0);
      expect(male.length).toBeGreaterThan(0);
      expect(male).not.toEqual(female);
    });

    // The persona axis is load-bearing: SLOT_POOLS addresses voices by index,
    // so a provider whose list is not reordered silently turns the two Studio
    // slots into the same voice.
    test("every provider exposes a distinct Clear and Warm persona", () => {
      for (const gender of ["female", "male"] as const) {
        for (const provider of ["gemini", "deepgram", "witai"]) {
          const [clear, warm] = resolveProviderVoices(provider, gender, "en");
          expect(clear).toBeTruthy();
          expect(warm).toBeTruthy();
          expect(clear).not.toBe(warm);
        }
      }
    });
  });

  describe("resolveVoicePool", () => {
    const slot = (id: string) => getVoiceSlot(id);

    test("Standard draws only from the free pool", () => {
      const providers = [
        ...new Set(
          resolveVoicePool(slot("standard"), "female", "en", "FREE").map(
            (c) => c.provider,
          ),
        ),
      ];
      expect(providers).toEqual(["edge", "witai"]);
    });

    test("Studio draws from the premium pool in pool order", () => {
      const providers = [
        ...new Set(
          resolveVoicePool(slot("studio"), "male", "en", "PREMIUM").map(
            (c) => c.provider,
          ),
        ),
      ];
      expect(providers).toEqual([
        "gemini",
        "deepgram",
        "elevenlabs",
        "edge",
        "witai",
      ]);
    });

    test("the two Studio slots resolve to different first candidates", () => {
      for (const gender of ["female", "male"] as const) {
        const clear = resolveVoicePool(slot("studio"), gender, "en", "PREMIUM");
        const warm = resolveVoicePool(
          slot("studio-2"),
          gender,
          "en",
          "PREMIUM",
        );
        expect(clear[0].voice).toBeTruthy();
        expect(warm[0].voice).toBeTruthy();
        expect(clear[0].voice).not.toBe(warm[0].voice);
      }
    });

    test("the two personas share no premium voice in any gender", () => {
      for (const gender of ["female", "male"] as const) {
        const premium = (id: string): string[] =>
          resolveVoicePool(slot(id), gender, "en", "PREMIUM")
            .filter((c) => c.provider === "gemini" || c.provider === "deepgram")
            .map((c) => c.voice);
        const overlap = premium("studio").filter((v) =>
          premium("studio-2").includes(v),
        );
        expect(overlap).toEqual([]);
      }
    });

    test("a provider appears at most once in a pool", () => {
      for (const id of ["standard", "studio", "studio-2"]) {
        const pool = resolveVoicePool(slot(id), "female", "en", "PREMIUM");
        const providers = pool.map((c) => c.provider);
        expect(new Set(providers).size).toBe(providers.length);
      }
    });

    test("a provider with no voice for the language is absent from the pool", () => {
      const providers = [
        ...new Set(
          resolveVoicePool(slot("studio"), "female", "zh", "PREMIUM").map(
            (c) => c.provider,
          ),
        ),
      ];
      // deepgram supports 7 languages and zh is not one of them, so it must
      // not be attempted (and therefore cannot be marked down for it).
      expect(providers).not.toContain("deepgram");
      // Wit answers 200 for zh but returns 3.4 KB of clipped audio, so it must
      // not be attempted either.
      expect(providers).not.toContain("witai");
      expect(providers).toEqual(["gemini", "elevenlabs", "edge"]);
    });

    test("a missing persona position is skipped, not clamped", () => {
      // French publishes exactly one deepgram voice per gender, so the Warm
      // persona has no deepgram candidate. Clamping would hand it the Clear
      // voice and make the two slots identical in French.
      const warm = resolveVoicePool(
        slot("studio-2"),
        "female",
        "fr",
        "PREMIUM",
      );
      expect(warm.find((c) => c.provider === "deepgram")).toBeUndefined();
      expect(warm.length).toBeGreaterThan(0);
    });

    test("an unset gender still yields a full pool", () => {
      expect(
        resolveVoicePool(slot("studio"), undefined, "en", "PREMIUM").length,
      ).toBeGreaterThan(0);
      expect(
        resolveVoicePool(slot("standard"), undefined, "en", "FREE").length,
      ).toBeGreaterThan(0);
    });

    test("an unknown slot resolves to nothing rather than throwing", () => {
      expect(
        resolveVoicePool(getVoiceSlot("nope"), "female", "en", "PREMIUM"),
      ).toEqual([]);
    });
  });

  describe("pipelineTierForSlot", () => {
    test("maps each slot onto its pipeline", () => {
      expect(pipelineTierForSlot(getVoiceSlot("standard"))).toBe("FREE");
      expect(pipelineTierForSlot(getVoiceSlot("studio"))).toBe("PREMIUM");
      expect(pipelineTierForSlot(getVoiceSlot("studio-2"))).toBe("PREMIUM");
    });

    test("an unknown slot is treated as the free pipeline", () => {
      expect(pipelineTierForSlot(getVoiceSlot("nope"))).toBe("FREE");
    });
  });

  describe("resolveExecutionTier", () => {
    test("a Paid account on Standard still runs on the free pool", () => {
      const slotTier = pipelineTierForSlot(getVoiceSlot("standard"));
      expect(slotTier).toBe("FREE");
      expect(resolveExecutionTier(slotTier, "PREMIUM")).toBe("FREE");
    });

    test("a Paid account on Studio runs on the premium pool", () => {
      const slotTier = pipelineTierForSlot(getVoiceSlot("studio"));
      expect(resolveExecutionTier(slotTier, "PREMIUM")).toBe("PREMIUM");
    });

    test("a throttled Paid account on Studio degrades to free, never errors", () => {
      const slotTier = pipelineTierForSlot(getVoiceSlot("studio"));
      expect(resolveExecutionTier(slotTier, "FREE")).toBe("FREE");
    });

    test("the same holds for the Warm persona", () => {
      const slotTier = pipelineTierForSlot(getVoiceSlot("studio-2"));
      expect(resolveExecutionTier(slotTier, "PREMIUM")).toBe("PREMIUM");
      expect(resolveExecutionTier(slotTier, "FREE")).toBe("FREE");
    });

    test("an absent voiceId never reaches the premium pool", () => {
      const slotTier = pipelineTierForSlot(getVoiceSlot(undefined));
      expect(resolveExecutionTier(slotTier, "PREMIUM")).toBe("FREE");
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
        slot: getVoiceSlot("standard"),
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
        slot: getVoiceSlot("standard"),
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
        slot: getVoiceSlot("studio"),
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
        slot: getVoiceSlot("studio"),
        tier: "PREMIUM",
        env,
        signal: new AbortController().signal,
        budgetMs: 20_000,
        cacheKey: null,
      });

      expect(result).toBeNull();
    });

    // A provider that accepts the request and never answers is the case that
    // used to end every synthesis in a 503: with no per-attempt cap the first
    // provider inherited the whole 20s budget, so the remaining providers were
    // never tried. Real time is unavoidable here — AbortSignal.timeout is a
    // native timer that fake timers do not drive — so this one is slow by
    // design rather than slept to a fixed duration.
    test("a provider that hangs is bounded and the next provider still answers", async () => {
      // Fresh module graph on purpose: the failover cases above deliberately
      // mark providers down, and "down" is memoized for the life of the
      // process. Sharing the top-level import would let this case skip the
      // provider under test and pass without ever hanging anything.
      vi.resetModules();
      const { runSpeechSynth: runUnpoisoned } =
        await import("@/services/speech");

      const env = mockEnv();
      const hangUntilAborted: HttpResponseResolver = ({ request }) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () =>
            reject(
              request.signal.reason instanceof Error
                ? request.signal.reason
                : new Error("aborted"),
            ),
          );
        });
      server.use(
        http.post(PROVIDER_URLS.geminiTtsGenerate, hangUntilAborted),
        http.post(PROVIDER_URLS.deepgramSpeak, () => mp3Response()),
      );

      const startedAt = Date.now();
      const result = await runUnpoisoned({
        text: "hello",
        lang: "en",
        gender: "female",
        slot: getVoiceSlot("studio"),
        tier: "PREMIUM",
        env,
        signal: new AbortController().signal,
        budgetMs: SPEECH_PIPELINE_TOTAL_MS,
        cacheKey: null,
      });
      const elapsedMs = Date.now() - startedAt;

      // The hanging provider is bounded at one attempt window rather than
      // consuming the pipeline, and what it leaves behind is enough for the
      // next provider to answer.
      expect(result?.provider).toBe("deepgram");
      expect(elapsedMs).toBeGreaterThanOrEqual(SPEECH_PER_PROVIDER_MS);
      expect(elapsedMs).toBeLessThan(SPEECH_PIPELINE_TOTAL_MS);
    }, 25_000);
  });
});
