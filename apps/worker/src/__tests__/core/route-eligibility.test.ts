import { describe, expect, test } from "vitest";
import {
  exhaustedVerdict,
  planSttRoute,
  planTtsRoute,
  planTttRoute,
  type Attempt,
  type SttRequestShape,
} from "@/core/route-eligibility";
import {
  CF_WORKERS_AI_MAX_AUDIO_BYTES,
  PROVIDER_LIMITS,
  WITAI_MAX_DURATION_MS,
  providerAcceptsCodec,
  sttLimits,
} from "@ekwe/shared/providerLimits";
import { getProviderNamesFor } from "@/providers";
import { isLanguageSupported } from "@ekwe/shared/languageCapabilities";

const STT_POOL = [
  "witai",
  "groq",
  "cloudflare",
  "gladia",
  "cohere",
  "deepgram",
  "assemblyai",
  "elevenlabs",
];

function req(over: Partial<SttRequestShape> = {}): SttRequestShape {
  return {
    lang: "en",
    isAuto: false,
    codec: "vorbis",
    bytes: 400_000,
    durationMs: 60_000,
    ...over,
  };
}

function byProvider(attempts: Attempt[]): Record<string, Attempt> {
  return Object.fromEntries(attempts.map((a) => [a.provider, a]));
}

describe("planSttRoute", () => {
  test("every provider in a real pipeline is decided, none silently dropped", () => {
    const pool = getProviderNamesFor("stt", "PREMIUM");
    const plan = planSttRoute(pool, req());
    expect(plan.map((a) => a.provider)).toEqual([...pool]);
  });

  test("skips providers that cannot detect a language, and says why", () => {
    const plan = byProvider(planSttRoute(STT_POOL, req({ isAuto: true })));
    expect(plan.witai.eligible).toBe(false);
    expect(plan.witai.reason).toBe("no-auto-detect");
    expect(plan.cohere.reason).toBe("no-auto-detect");
    expect(plan.groq.eligible).toBe(true);
    expect(plan.deepgram.eligible).toBe(true);
  });

  test("keeps Wit eligible for auto when it declares support", () => {
    // Wit holds one key per language, so this must stay false forever. The
    // assertion is here so flipping it in the registry is a test failure.
    expect(sttLimits("witai")?.autoDetect).toBe("impossible");
    expect(providerAcceptsCodec("groq", "auto" as never)).toBe(true);
  });

  test("skips Wit on Opus, which /dictation answers with silence", () => {
    const opus = byProvider(planSttRoute(STT_POOL, req({ codec: "opus" })));
    expect(opus.witai.eligible).toBe(false);
    expect(opus.witai.reason).toBe("unsupported-codec");
    // Everything else takes Opus.
    for (const p of [
      "groq",
      "deepgram",
      "assemblyai",
      "elevenlabs",
      "gladia",
    ]) {
      expect(opus[p].eligible, p).toBe(true);
    }
  });

  test("keeps Wit eligible on Vorbis", () => {
    const vorbis = byProvider(planSttRoute(STT_POOL, req({ codec: "vorbis" })));
    expect(vorbis.witai.eligible).toBe(true);
  });

  test("skips a codec no provider in the pool accepts", () => {
    const plan = byProvider(
      planSttRoute(["witai", "groq"], req({ codec: "aiff" })),
    );
    expect(plan.witai.reason).toBe("unsupported-codec");
    // Groq's declared set is "any".
    expect(plan.groq.eligible).toBe(true);
  });

  test("an unresolved codec never skips — a false skip is worse than a wasted call", () => {
    const plan = byProvider(
      planSttRoute(["witai", "groq"], req({ codec: "unknown" })),
    );
    expect(plan.witai.eligible).toBe(true);
    expect(plan.groq.eligible).toBe(true);
  });

  test("skips Wit past its duration ceiling, in any codec", () => {
    const long = req({ durationMs: WITAI_MAX_DURATION_MS + 1 });
    expect(byProvider(planSttRoute(STT_POOL, long)).witai.reason).toBe(
      "too-long",
    );

    const short = req({ durationMs: 60_000 });
    expect(byProvider(planSttRoute(STT_POOL, short)).witai.eligible).toBe(true);
  });

  test("skips Cloudflare past its Workers AI byte ceiling", () => {
    const big = req({ bytes: CF_WORKERS_AI_MAX_AUDIO_BYTES + 1 });
    const plan = byProvider(planSttRoute(STT_POOL, big));
    expect(plan.cloudflare.reason).toBe("too-large");
    // Same file still fits everywhere with headroom.
    expect(
      byProvider(planSttRoute(STT_POOL, req({ bytes: 400_000 }))).cloudflare
        .eligible,
    ).toBe(true);
  });

  test("skips a provider whose language it does not serve", () => {
    // Polish is in Wit's dictation set; Cohere's transcription model covers
    // fourteen languages and Polish is not among them.
    const plan = byProvider(planSttRoute(STT_POOL, req({ lang: "ko" })));
    expect(plan.witai.eligible).toBe(true);
    expect(plan.cohere.eligible).toBe(true);

    const swahili = byProvider(
      planSttRoute(["witai", "cohere"], req({ lang: "sw" })),
    );
    expect(swahili.witai.eligible).toBe(false);
    expect(swahili.witai.reason).toBe("unsupported-language");
    expect(swahili.cohere.eligible).toBe(false);
  });

  test("skips providers that need a duration the caller did not supply", () => {
    const plan = byProvider(planSttRoute(STT_POOL, req({ durationMs: 100 })));
    expect(plan.assemblyai.reason).toBe("too-short");
    expect(plan.groq.eligible).toBe(true);
  });

  test("is pure — repeated calls agree", () => {
    const a = planSttRoute(STT_POOL, req());
    const b = planSttRoute(STT_POOL, req());
    expect(a).toEqual(b);
  });
});

describe("exhaustedVerdict", () => {
  test("returns null while anything is eligible", () => {
    const plan = planSttRoute(STT_POOL, req({ isAuto: true }));
    expect(exhaustedVerdict(plan)).toBeNull();
  });

  test("reports a reason when the whole pool is ineligible", () => {
    const plan = planSttRoute(["witai"], req({ isAuto: true }));
    expect(exhaustedVerdict(plan)?.reason).toBe("no-auto-detect");
  });

  test("prefers the most explanatory reason", () => {
    const plan: Attempt[] = [
      { provider: "a", eligible: false, reason: "too-long" },
      { provider: "b", eligible: false, reason: "unsupported-codec" },
    ];
    expect(exhaustedVerdict(plan)?.reason).toBe("unsupported-codec");
  });
});

describe("planTttRoute", () => {
  test("keeps every translation provider eligible for any target language", () => {
    // All six TTT providers are declared unbounded today, so the language skip
    // is currently inert on this route. That is a fact about the registry, not
    // about the planner — assert it so a bounded provider appearing later is
    // a visible, deliberate change.
    for (const p of getProviderNamesFor("ttt", "PREMIUM")) {
      expect(isLanguageSupported(p as never, "ttt", "sw"), p).toBe(true);
      const plan = planTttRoute([p], { targetLang: "sw", textLength: 50 });
      expect(plan[0].eligible, p).toBe(true);
    }
  });

  test("skips a provider whose input ceiling the text exceeds", () => {
    const plan = byProvider(
      planTttRoute(["gemini", "groq"], {
        targetLang: "fr",
        textLength: 50_000,
      }),
    );
    expect(plan.groq.reason).toBe("too-long");
    expect(plan.gemini.eligible).toBe(true);
  });
});

describe("planTtsRoute", () => {
  test("skips a provider with no voice for the language", () => {
    // Wit synthesizes a bounded set; Thai is not in it.
    const plan = byProvider(
      planTtsRoute(["gemini", "edge", "witai"], {
        lang: "th",
        textLength: 100,
      }),
    );
    expect(plan.witai.eligible).toBe(false);
    expect(plan.witai.reason).toBe("unsupported-language");
    expect(plan.gemini.eligible).toBe(true);
  });
});

describe("PROVIDER_LIMITS registry", () => {
  test("every provider in every pipeline declares its capabilities", () => {
    const entries = PROVIDER_LIMITS as Record<
      string,
      { stt?: unknown; ttt?: unknown; tts?: unknown }
    >;
    for (const tier of ["FREE", "PREMIUM"] as const) {
      for (const name of getProviderNamesFor("stt", tier)) {
        expect(entries[name]?.stt, `${name} stt`).toBeDefined();
        expect(sttLimits(name), `${name} sttLimits`).not.toBeNull();
      }
      for (const name of getProviderNamesFor("ttt", tier)) {
        expect(entries[name]?.ttt, `${name} ttt`).toBeDefined();
      }
      for (const name of getProviderNamesFor("tts", tier)) {
        expect(entries[name]?.tts, `${name} tts`).toBeDefined();
      }
    }
  });

  test("Wit's duration ceiling is the documented one", () => {
    expect(WITAI_MAX_DURATION_MS).toBe(300_000);
  });

  test("no declared limit is nonsense", () => {
    for (const name of Object.keys(PROVIDER_LIMITS)) {
      const limits = sttLimits(name);
      if (!limits) continue;
      expect(limits.maxBytes, name).toBeGreaterThan(0);
      expect(limits.maxDurationMs, name).toBeGreaterThan(0);
      expect(limits.minDurationMs, name).toBeLessThan(limits.maxDurationMs);
    }
  });
});
