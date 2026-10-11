import { describe, expect, it } from "vitest";

import { LANGUAGE_CODES, LANGUAGE_CODE_SET } from "../languages";
import {
  LANGUAGE_CAPABILITIES,
  STREAM_ROUTES,
  STREAM_ROUTE_IDS,
  autoDetectLanguages,
  isLanguageSupported,
  isLanguageUnbounded,
  hasNativeVoice,
  languageTier,
  pinLanguage,
  providerIdsForCapability,
  streamRouteById,
  streamRoutesFor,
  streamSkipReason,
  streamLanguages,
  toProviderCode,
  unsupportedLanguages,
  unsupportedStreamLanguages,
  type LanguageCapability,
  type LanguageCapabilitySpec,
  type ProviderId,
} from "../languageCapabilities";

const CAPABILITIES: LanguageCapability[] = ["stt", "tts", "ttt"];

const specs = (): Array<
  [ProviderId, LanguageCapability, LanguageCapabilitySpec]
> => {
  const out: Array<[ProviderId, LanguageCapability, LanguageCapabilitySpec]> =
    [];
  for (const [provider, caps] of Object.entries(LANGUAGE_CAPABILITIES) as Array<
    [ProviderId, Partial<Record<LanguageCapability, LanguageCapabilitySpec>>]
  >) {
    for (const [capability, spec] of Object.entries(caps) as Array<
      [LanguageCapability, LanguageCapabilitySpec]
    >) {
      out.push([provider, capability, spec]);
    }
  }
  return out;
};

describe("language capability registry", () => {
  it("only ever names codes that exist in the shared catalog", () => {
    for (const [provider, capability, spec] of specs()) {
      for (const code of spec.codes) {
        expect(
          LANGUAGE_CODE_SET.has(code),
          `${provider}.${capability} lists "${code}", which is not in LANGUAGE_CODES`,
        ).toBe(true);
      }
    }
  });

  it("declares no alias for a code the provider does not list", () => {
    for (const [provider, capability, spec] of specs()) {
      for (const canonical of Object.keys(spec.aliases ?? {})) {
        expect(
          spec.codes.includes(canonical),
          `${provider}.${capability} aliases "${canonical}" but does not list it`,
        ).toBe(true);
      }
    }
  });

  it("has no duplicate codes within a capability spec", () => {
    for (const [provider, capability, spec] of specs()) {
      expect(
        new Set(spec.codes).size,
        `${provider}.${capability} has duplicate codes`,
      ).toBe(spec.codes.length);
    }
  });

  it("no offered language lacks a transcription provider", () => {
    // The offered tier is deliberately drawn from languages with real coverage:
    // every code below was verified to have a transcription provider in the free
    // pool, so a picker can never offer something that always fails. This is the
    // invariant that lets the catalog shrink to the offered set.
    expect(unsupportedLanguages("stt")).toEqual([]);
  });

  it("never claims a language no provider can transcribe", () => {
    // The invariant this suite exists to protect: nothing in the catalog may be
    // advertised for transcription unless a provider really serves it. Wit's
    // over-broad list broke exactly this.
    for (const code of unsupportedLanguages("stt")) {
      for (const provider of providerIdsForCapability("stt")) {
        expect(
          isLanguageSupported(provider, "stt", code),
          `${provider} claims ${code}`,
        ).toBe(false);
      }
    }
  });

  it("maps Javanese and Norwegian only for the Whisper family", () => {
    const whisperStt = [
      "assemblyai",
      "cloudflare",
      "gladia",
      "groq",
    ] as ProviderId[];

    for (const provider of whisperStt) {
      expect(toProviderCode(provider, "stt", "jv")).toBe("jw");
      expect(toProviderCode(provider, "stt", "nb")).toBe("no");
    }

    // Canonical everywhere else.
    for (const provider of ["witai", "cohere", "deepgram"] as ProviderId[]) {
      expect(toProviderCode(provider, "stt", "jv")).toBe("jv");
      expect(toProviderCode(provider, "tts", "jv")).toBe("jv");
    }
  });

  it("returns the canonical code when a provider has no alias for it", () => {
    expect(toProviderCode("groq", "stt", "en")).toBe("en");
    expect(toProviderCode("groq", "stt", "yue")).toBe("yue");
  });

  it("keeps Javanese canonical for synthesis even though STT rewrites it", () => {
    // The original bug: a provider-wide alias would have sent "jw" to TTS.
    expect(toProviderCode("assemblyai", "tts", "jv")).toBe("jv");
  });

  it("does not treat Wit as language-agnostic for synthesis", () => {
    // Regression guard: "all" previously let unsupported codes through.
    for (const code of ["yue", "ar", "th", "hi", "ja", "ko", "zh", "ta"]) {
      expect(LANGUAGE_CODE_SET.has(code)).toBe(true);
      expect(isLanguageSupported("witai", "tts", code)).toBe(false);
    }
    expect(isLanguageSupported("witai", "tts", "en")).toBe(true);
  });

  it("registers the minority Wit voices verified by synthesis", () => {
    // Wit's advertised list omits these, but synthesizing them returns real
    // audio that transcribes back correctly ("Azobomir", "Salam", "Moro").
    for (const code of ["lb", "nn", "ba", "haw", "oc", "tk", "sn", "ru"]) {
      expect(isLanguageSupported("witai", "tts", code)).toBe(true);
    }
  });

  it("does not claim Wit speaks scripts it can only return silence for", () => {
    // Measured with check-tts.mjs: 576 bytes of silence for these, and ~3.4 KB
    // of clipped audio for the CJK/Hangul/Arabic ones. Listing them routed
    // synthesis to a provider that cannot serve it.
    for (const code of ["hi", "th", "ta", "te", "ja", "ko", "zh", "ar"]) {
      expect(isLanguageSupported("witai", "tts", code)).toBe(false);
    }
    // Latin-script coverage is real and still registered.
    for (const code of ["en", "es", "fr", "de", "it", "pt", "nl", "id", "pl"]) {
      expect(isLanguageSupported("witai", "tts", code)).toBe(true);
    }
  });

  it("narrows Deepgram TTS below its recognition set", () => {
    expect(isLanguageSupported("deepgram", "stt", "ru")).toBe(true);
    expect(isLanguageSupported("deepgram", "tts", "ru")).toBe(false);
    expect(isLanguageSupported("deepgram", "tts", "ja")).toBe(true);
  });

  it("narrows ElevenLabs the same way, and keeps it honest about Nigeria", () => {
    // Scribe transcribes Yoruba and Igbo, so STT must accept them...
    for (const code of ["yo", "ig", "ha", "en", "fr", "es"]) {
      expect(isLanguageSupported("elevenlabs", "stt", code)).toBe(true);
    }
    // ...while Flash v2.5 speaks none of the Nigerian languages. Claiming them
    // for TTS would route a paying user to audio that cannot say their language,
    // which is the exact failure an enumerated registry exists to prevent.
    for (const code of ["yo", "ig", "ha"]) {
      expect(isLanguageSupported("elevenlabs", "tts", code)).toBe(false);
    }
    expect(isLanguageSupported("elevenlabs", "tts", "en")).toBe(true);
    expect(isLanguageSupported("elevenlabs", "tts", "fr")).toBe(true);
    // A language outside both the catalog and Flash's 32.
    expect(isLanguageSupported("elevenlabs", "tts", "zu")).toBe(false);
    // Multilingual v2's 29 plus the three Flash adds.
    expect(isLanguageSupported("elevenlabs", "tts", "hu")).toBe(true);
    expect(isLanguageSupported("elevenlabs", "tts", "vi")).toBe(true);
    expect(isLanguageSupported("elevenlabs", "tts", "no")).toBe(true);
  });

  it("keeps the Scribe wire spelling out of the canonical catalog", () => {
    // The registry speaks canonical codes; the 639-3 form is only ever what we
    // put on the wire, so it must not leak back as a language of its own.
    expect(LANGUAGE_CODE_SET.has("eng")).toBe(false);
    expect(toProviderCode("elevenlabs", "stt", "en")).toBe("eng");
    expect(toProviderCode("elevenlabs", "stt", "yo")).toBe("yor");
    // No 639-1 code exists for Cantonese, so it is sent unchanged.
    expect(toProviderCode("elevenlabs", "stt", "yue")).toBe("yue");
  });

  it("treats language-agnostic providers as supporting any code", () => {
    for (const provider of ["edge", "gemini"] as ProviderId[]) {
      expect(isLanguageSupported(provider, "tts", "yue")).toBe(true);
      expect(isLanguageSupported(provider, "tts", "zu")).toBe(true);
    }
  });

  it("refuses a capability the provider never declared", () => {
    // "Can I use this at all" — an undeclared capability must not read as a
    // yes, or a routing gate would send work to a provider that cannot do it.
    expect(isLanguageSupported("assemblyai", "tts", "en")).toBe(false);
    expect(isLanguageSupported("gladia", "ttt", "en")).toBe(false);
    expect(providerIdsForCapability("tts")).not.toContain("assemblyai");
    expect(providerIdsForCapability("stt")).not.toContain("gemini");
  });

  it("treats Cohere translation as unbounded like every other LLM", () => {
    // It used to be pinned to fourteen codes while Groq, Gemini, Mistral,
    // OpenRouter and Workers AI were all unbounded, so Cohere was skipped for
    // languages the pipeline could otherwise serve.
    expect(isLanguageSupported("cohere", "ttt", "sw")).toBe(true);
    expect(isLanguageSupported("cohere", "stt", "sw")).toBe(false);
  });

  it("keeps translate coverage separate from transcription coverage", () => {
    expect(isLanguageSupported("gladia", "ttt", "sw")).toBe(false);
    expect(isLanguageSupported("groq", "ttt", "sw")).toBe(true);
  });

  it("covers every capability in the registry", () => {
    for (const capability of CAPABILITIES) {
      expect(
        providerIdsForCapability(capability).length,
        `no provider declares "${capability}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("reports nothing unsupported while an unbounded provider exists", () => {
    expect(isLanguageUnbounded("ttt")).toBe(true);
    expect(unsupportedLanguages("ttt")).toEqual([]);
    // Translation is unbounded because an LLM will attempt anything. Transcription
    // is fully enumerated, and the offered tier is drawn only from languages it
    // covers, so nothing offered is untranscribable.
    expect(isLanguageUnbounded("stt")).toBe(false);
    expect(unsupportedLanguages("stt")).toEqual([]);
  });

  it("distinguishes an unbounded capability from one that supports nothing", () => {
    // Groq translates anything...
    expect(isLanguageSupported("groq", "ttt", "sw")).toBe(true);
    // ...but AssemblyAI cannot translate at all.
    expect(isLanguageSupported("assemblyai", "ttt", "sw")).toBe(false);
  });
});

describe("stream routes", () => {
  it("only names codes that exist in the shared catalog", () => {
    for (const route of STREAM_ROUTES) {
      for (const code of route.codes) {
        expect(
          LANGUAGE_CODE_SET.has(code),
          `${route.id} lists "${code}", which is not in LANGUAGE_CODES`,
        ).toBe(true);
      }
    }
  });

  it("has a unique id per route", () => {
    expect(new Set(STREAM_ROUTE_IDS).size).toBe(STREAM_ROUTES.length);
  });

  it("declares no alias for a code the route does not list", () => {
    for (const route of STREAM_ROUTES) {
      for (const canonical of Object.keys(route.aliases ?? {})) {
        expect(
          route.codes.includes(canonical),
          `${route.id} aliases "${canonical}" but does not list it`,
        ).toBe(true);
      }
    }
  });

  it("gives every route a distinct priority", () => {
    const priorities = STREAM_ROUTES.map((r) => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("resolves a route by id", () => {
    expect(streamRouteById("deepgram-flux-multi")?.model).toBe(
      "flux-general-multi",
    );
    expect(streamRouteById("nope")).toBeUndefined();
  });

  it("keeps Flux ahead of AssemblyAI and Wit last", () => {
    // Endpointing quality decides this, not word error rate: Flux's turn
    // detection is trained in, AssemblyAI's is a silence threshold, and Wit
    // cannot be given turn control at all.
    const ids = streamRoutesFor("en").map((r) => r.id);
    expect(ids[0]).toBe("deepgram-flux-multi");
    expect(ids[ids.length - 1]).toBe("witai");
  });

  it("leaves Wit last even though it covers the most languages", () => {
    const wit = streamRouteById("witai")!;
    const flux = streamRouteById("deepgram-flux-multi")!;
    expect(wit.codes.length).toBeGreaterThan(flux.codes.length);
    expect(wit.priority).toBeGreaterThan(flux.priority);
  });

  it("routes a language to only the routes that list it", () => {
    for (const route of streamRoutesFor("sw")) {
      expect(route.codes).toContain("sw");
    }
  });

  it("never offers Wit for auto, because it cannot detect", () => {
    const ids = streamRoutesFor("auto").map((r) => r.id);
    expect(ids).not.toContain("witai");
    for (const route of streamRoutesFor("auto")) {
      expect(route.autoDetect).toBe(true);
    }
  });

  it("treats an empty language as auto", () => {
    expect(streamRoutesFor("").map((r) => r.id)).toEqual(
      streamRoutesFor("auto").map((r) => r.id),
    );
  });

  it("gives Gladia the Whisper spelling, probed from /v2/live", () => {
    const gladia = streamRouteById("gladia-solaria")!;
    // /v2/live returns 400 for "jv" and "nb", and 201 for "jw" and "no". The
    // canonical code stays in `codes` so routing still finds the route; only
    // the wire spelling is rewritten.
    expect(gladia.aliases?.jv).toBe("jw");
    expect(gladia.aliases?.nb).toBe("no");
    expect(gladia.codes).toContain("jv");
    expect(gladia.codes).toContain("nb");
  });

  it("routes English down the full quality order", () => {
    expect(streamRoutesFor("en").map((r) => r.id)).toEqual([
      "deepgram-flux-multi",
      "assemblyai-u3-rt-pro",
      "deepgram-nova-3",
      "gladia-solaria",
      "witai",
    ]);
  });

  it("skips straight past routes that lack the language", () => {
    // Swahili is in neither Flux's ten nor AssemblyAI's six nor Deepgram's
    // thirty-three, so the language-aware order lands on Gladia immediately
    // rather than trying four providers that would each be skipped.
    expect(streamRoutesFor("sw").map((r) => r.id)).toEqual(["gladia-solaria"]);
  });

  it("no offered language lacks a streaming route", () => {
    // Streaming coverage is narrower than transcription, so the offered tier was
    // chosen to clear it too — otherwise a client could select a language that
    // fails on attach.
    expect(unsupportedStreamLanguages()).toEqual([]);
  });

  it("covers a hundred languages for explicit streaming", () => {
    expect(streamLanguages().length).toBe(100);
  });

  it("detects a hundred languages on its own", () => {
    expect(autoDetectLanguages().length).toBe(100);
  });

  it("gives Gladia the Whisper spelling, probed from /v2/live", () => {
    const gladia = streamRouteById("gladia-solaria")!;
    // /v2/live returns 400 for "jv" and "nb", and 201 for "jw" and "no".
    expect(gladia.aliases?.jv).toBe("jw");
    expect(gladia.aliases?.nb).toBe("no");
    expect(gladia.codes).toContain("jv");
    expect(gladia.codes).toContain("nb");
  });

  it("gives Gladia the Whisper spelling, probed from /v2/live", () => {
    const gladia = streamRouteById("gladia-solaria")!;
    // /v2/live returns 400 for "jv" and "nb", and 201 for "jw" and "no".
    expect(gladia.aliases?.jv).toBe("jw");
    expect(gladia.aliases?.nb).toBe("no");
    expect(gladia.codes).toContain("jv");
    expect(gladia.codes).toContain("nb");
  });

  it("marks the non-websocket route so turn control is never sent to it", () => {
    expect(streamRouteById("witai")!.websocket).toBe(false);
    expect(streamRouteById("witai")!.wire).toBe("wav_pcm");
    for (const id of STREAM_ROUTE_IDS.filter((i) => i !== "witai")) {
      const route = streamRouteById(id)!;
      expect(route.websocket).toBe(true);
      expect(route.wire).toBe("pcm_s16le");
    }
  });

  it("only claims per-turn language reporting where it is true", () => {
    // Flux and Gladia both populate a language on every transcript event.
    expect(streamRouteById("deepgram-flux-multi")!.reportsLanguage).toBe(true);
    expect(streamRouteById("gladia-solaria")!.reportsLanguage).toBe(true);
    expect(streamRouteById("deepgram-nova-3")!.reportsLanguage).toBe(false);
  });
});

describe("streamSkipReason", () => {
  it("answers auto from what the routes can detect", () => {
    expect(streamSkipReason("auto")).toBeNull();
  });

  it("names a language nothing can route", () => {
    expect(streamSkipReason("zzz")).toBe("language");
  });
});

describe("pinLanguage", () => {
  it("takes the first real report", () => {
    expect(pinLanguage(null, "es", false)).toBe("es");
  });

  it("never overwrites a pin", () => {
    expect(pinLanguage("es", "fr", false)).toBe("es");
  });

  it("ignores an empty report instead of clearing the pin", () => {
    // A provider saying "I could not tell" is not a reason to forget.
    expect(pinLanguage(null, "", false)).toBeNull();
    expect(pinLanguage(null, "   ", false)).toBeNull();
    expect(pinLanguage(null, undefined, false)).toBeNull();
  });

  it("refuses to move once a final has been shown to the user", () => {
    // Retroactively re-attributing already-displayed text would corrupt the
    // translation and the history row.
    expect(pinLanguage(null, "fr", true)).toBeNull();
    expect(pinLanguage("es", "fr", true)).toBe("es");
  });

  it("trims a reported code", () => {
    expect(pinLanguage(null, " pt ", false)).toBe("pt");
  });
});

describe("language tiers", () => {
  it("calls a language native only when a provider declares it", () => {
    expect(languageTier("deepgram", "tts", "en")).toBe("native");
    expect(languageTier("edge", "tts", "en")).toBe("native");
    expect(languageTier("witai", "tts", "en")).toBe("native");
  });

  it("calls Wit's non-English coverage multilingual, not native", () => {
    // Wit speaks these with the English key, so the voice is an English one
    // reading the text rather than an authored French one. Tamil no longer
    // appears: it is silent, not multilingual.
    expect(languageTier("witai", "tts", "fr")).toBe("multilingual");
    expect(languageTier("witai", "tts", "ta")).toBeNull();
  });

  it("returns null rather than a tier for a language a provider cannot speak", () => {
    expect(languageTier("deepgram", "tts", "ta")).toBeNull();
    // "oc" is registered: it synthesizes real Occitan audio. Use a script Wit
    // genuinely cannot voice.
    expect(languageTier("witai", "tts", "th")).toBeNull();
  });

  it("calls Edge's fallback locales multilingual, not native", () => {
    // Edge takes any language, but a locale with no Neural voice is read by
    // the English multilingual voice. That is a real answer, so the language
    // stays selectable — the tier is what tells the truth about the audio.
    expect(languageTier("edge", "tts", "oc")).toBe("multilingual");
    expect(languageTier("edge", "tts", "ta")).toBe("native");
  });

  it("returns null for an unknown provider or capability", () => {
    expect(languageTier("nope" as ProviderId, "tts", "en")).toBeNull();
    expect(languageTier("edge", "stt", "en")).toBeNull();
  });

  it("treats an unbounded provider as multilingual, never native", () => {
    // Gemini claims every catalog language; nothing is a verified native voice.
    expect(languageTier("gemini", "tts", "en")).toBe("multilingual");
  });

  it("agrees with isLanguageSupported about who can be skipped", () => {
    for (const provider of providerIdsForCapability("tts")) {
      for (const code of LANGUAGE_CODES) {
        expect(languageTier(provider, "tts", code) !== null).toBe(
          isLanguageSupported(provider, "tts", code),
        );
      }
    }
  });

  it("never declares a native language the provider does not list", () => {
    for (const [provider, capability, spec] of specs()) {
      for (const code of spec.native ?? []) {
        expect(spec.codes).toContain(code);
        expect(languageTier(provider, capability, code)).toBe("native");
      }
    }
  });

  it("leaves Deepgram's Aura native voices limited to its seven", () => {
    for (const code of ["en", "es", "de", "fr", "nl", "it", "ja"]) {
      expect(languageTier("deepgram", "tts", code)).toBe("native");
    }
    expect(
      LANGUAGE_CODES.filter(
        (c) => languageTier("deepgram", "tts", c) === "native",
      ),
    ).toHaveLength(7);
  });

  it("does not promise a native voice for every catalog language", () => {
    // Most catalog languages are covered by a multilingual voice only. A
    // caller may use this to soften a promise, never to hide a language that
    // can still be read aloud.
    expect(hasNativeVoice("tts", "en")).toBe(true);
    expect(hasNativeVoice("tts", "ta")).toBe(true);
    expect(hasNativeVoice("tts", "pa")).toBe(false);
    expect(
      LANGUAGE_CODES.filter((c) => hasNativeVoice("tts", c)),
    ).not.toHaveLength(LANGUAGE_CODES.length);
  });
});

describe("Edge synthesis coverage", () => {
  const edgeTtsSpec = (): LanguageCapabilitySpec => {
    const spec = LANGUAGE_CAPABILITIES.edge.tts;
    if (!spec) throw new Error("edge must declare tts");
    return spec;
  };

  it("separates the 76 native locales from the catalog it can still read", () => {
    // Edge takes any language, so it stays unbounded in practice. What changed
    // is that the 76 authored locales are now named, which is what lets the
    // tier report "native" versus "multilingual" honestly.
    const edge = edgeTtsSpec();
    expect(edge.unbounded).toBeUndefined();
    expect(edge.codes).toHaveLength(LANGUAGE_CODES.length);
    expect(edge.native).toHaveLength(76);
    expect(new Set(edge.native).size).toBe(76);
    for (const code of edge.native ?? []) expect(edge.codes).toContain(code);
  });

  it("still offers Cantonese natively, the one language only Edge speaks", () => {
    expect(languageTier("edge", "tts", "yue")).toBe("native");
    expect(languageTier("witai", "tts", "yue")).toBeNull();
    expect(languageTier("deepgram", "tts", "yue")).toBeNull();
  });

  it("leaves no catalog language without a synthesis provider", () => {
    // The seven that Edge answers only through its English fallback are still
    // covered, so the picker does not have to hide anything.
    const uncovered = LANGUAGE_CODES.filter(
      (c) =>
        !isLanguageSupported("edge", "tts", c) &&
        !isLanguageSupported("witai", "tts", c) &&
        !isLanguageSupported("deepgram", "tts", c),
    );
    expect(uncovered).toEqual([]);
  });

  it("routes the 63 fallback locales to Edge's English voice, not a failure", () => {
    const fallback = LANGUAGE_CODES.filter(
      (c) => languageTier("edge", "tts", c) === "multilingual",
    );
    // 139 catalog codes, 76 authored locales, the rest answered by the English
    // multilingual voice. These are the languages that were previously
    // indistinguishable from native ones.
    expect(fallback).toHaveLength(63);
    for (const code of fallback) {
      expect(isLanguageSupported("edge", "tts", code)).toBe(true);
      // Worth reading aloud, but never worth promising an authored voice.
      expect(hasNativeVoice("tts", code)).toBe(false);
    }
  });

  it("covers the scripts Wit cannot voice through the Edge fallback", () => {
    // The eight languages check-tts.mjs measured Wit returning silence or a
    // clipped character-by-character reading for. Edge carries authored voices
    // for every one, so the free pool still resolves them.
    const gaps = ["hi", "th", "ta", "te", "ja", "ko", "zh", "ar"];
    for (const code of gaps) {
      expect(isLanguageSupported("witai", "tts", code)).toBe(false);
      expect(languageTier("edge", "tts", code)).toBe("native");
    }
  });
});
