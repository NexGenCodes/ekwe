import { describe, test, expect } from "vitest";

import { getStreamRoutes, providerSupportsLanguage } from "@/providers";
import { SUPPORTED_LANGUAGE_CODES } from "@ekwe/shared/languages";
import {
  streamRoutesFor,
  unsupportedLanguages,
  unsupportedStreamLanguages,
} from "@ekwe/shared/languageCapabilities";

/**
 * The language *data* — which codes each provider accepts, and how they are
 * spelled on the wire — is asserted once in
 * packages/shared/src/__tests__/languageCapabilities.test.ts.
 *
 * What belongs here is the worker's own job: that the routing gate reads that
 * registry, and that narrowing a provider's coverage actually removes it from
 * the pool for that language instead of failing at request time.
 */

describe("providerSupportsLanguage", () => {
  test("gates batch transcription on the registry", () => {
    expect(providerSupportsLanguage("witai", "stt", "en")).toBe(true);
    expect(providerSupportsLanguage("groq", "stt", "en")).toBe(true);
    expect(providerSupportsLanguage("cloudflare", "stt", "en")).toBe(true);
    expect(providerSupportsLanguage("gladia", "stt", "en")).toBe(true);
    expect(providerSupportsLanguage("assemblyai", "stt", "en")).toBe(true);
  });

  test("keeps Wit reachable for Nigerian languages", () => {
    // Wit leads both STT pools, so a language it cannot transcribe is a failed
    // round-trip on every request before the pool moves on. Probing every Wit
    // key against /dictation shows it transcribes 32 languages and answers
    // `Speech recognition is not supported for language: xx` for the rest —
    // including all three Nigerian ones.
    for (const code of ["ig", "yo", "ha"]) {
      expect(providerSupportsLanguage("witai", "stt", code)).toBe(false);
    }
  });

  test("still offers Nigerian transcription where a provider really serves it", () => {
    // Excluding Wit must not empty the pool for the product's core languages.
    // Yoruba and Hausa are in Whisper's hundred, and Scribe covers all three.
    for (const code of ["yo", "ha"]) {
      expect(providerSupportsLanguage("groq", "stt", code)).toBe(true);
    }
    for (const code of ["yo", "ig", "ha"]) {
      expect(providerSupportsLanguage("elevenlabs", "stt", code)).toBe(true);
    }
    // Igbo is the exception and has to stay an exception: it is absent from
    // Whisper's own tokenizer, so only Scribe serves it. Saying otherwise would
    // route a request to a provider that 400s.
    expect(providerSupportsLanguage("groq", "stt", "ig")).toBe(false);
  });

  test("keeps Wit synthesis and dictation as separately measured lists", () => {
    // The two endpoints answer 200 with unusable audio for scripts they cannot
    // voice, so coverage is measured rather than copied between them.
    // Synthesis stays wider than dictation...
    expect(providerSupportsLanguage("witai", "stt", "lb")).toBe(false);
    expect(providerSupportsLanguage("witai", "tts", "lb")).toBe(true);
    // ...but neither claims the scripts check-tts.mjs measured as silence.
    for (const code of ["hi", "th", "ta", "te", "ja", "ko", "zh", "ar"]) {
      expect(providerSupportsLanguage("witai", "tts", code)).toBe(false);
    }
  });

  test("keeps Wit reachable for the languages dictation does serve", () => {
    for (const code of ["en", "fr", "es", "pt", "ru", "zh"]) {
      expect(providerSupportsLanguage("witai", "stt", code)).toBe(true);
    }
  });

  test("excludes Cohere from languages it cannot transcribe", () => {
    expect(providerSupportsLanguage("cohere", "stt", "en")).toBe(true);
    // Igbo is a real product language, but Cohere does not accept it. The pool
    // must skip Cohere rather than send a request it will reject.
    expect(providerSupportsLanguage("cohere", "stt", "ig")).toBe(false);
  });

  test("excludes Deepgram from languages outside its coverage", () => {
    expect(providerSupportsLanguage("deepgram", "stt", "en")).toBe(true);
    expect(providerSupportsLanguage("deepgram", "stt", "ru")).toBe(true);
    // Cantonese is in the catalog and in Whisper, but not in Deepgram's set.
    expect(providerSupportsLanguage("deepgram", "stt", "yue")).toBe(false);
  });

  test("routes streaming on the route table, not the provider name", () => {
    // u3-rt-pro covers six languages; the batch endpoint covers a hundred, so
    // the provider name alone cannot answer this.
    expect(streamRoutesFor("fr").map((r) => r.id)).toContain(
      "assemblyai-u3-rt-pro",
    );
    expect(streamRoutesFor("sw").map((r) => r.id)).not.toContain(
      "assemblyai-u3-rt-pro",
    );
    // Batch is unaffected by the streaming restriction.
    expect(providerSupportsLanguage("assemblyai", "stt", "fr")).toBe(true);
  });

  test("gives Flux and Nova-3 different language sets from one module", () => {
    // The reason streaming is keyed on a route: Deepgram ships two models and a
    // single `deepgram` entry could not say that Flux covers ten and Nova-3
    // covers thirty-three.
    // Chinese is in Nova-3's thirty-three and not in Flux's ten.
    const zh = streamRoutesFor("zh").map((r) => r.id);
    expect(zh).toContain("deepgram-nova-3");
    expect(zh).not.toContain("deepgram-flux-multi");
    // Spanish is in both, and Flux is preferred.
    const es = streamRoutesFor("es").map((r) => r.id);
    expect(es).toContain("deepgram-flux-multi");
    expect(es).toContain("deepgram-nova-3");
  });

  test("does not gate auto-detect, which has no language to check", () => {
    // Still requires the provider to implement the capability — only the
    // language check is skipped.
    for (const provider of [
      "witai",
      "groq",
      "cloudflare",
      "gladia",
      "cohere",
      "deepgram",
      "assemblyai",
      "elevenlabs",
    ]) {
      expect(providerSupportsLanguage(provider, "stt", "auto")).toBe(true);
    }
  });

  test("refuses a capability the provider does not implement", () => {
    // AssemblyAI has no synthesis; a pool that trusted this would call it.
    expect(providerSupportsLanguage("assemblyai", "tts", "en")).toBe(false);
    // OpenRouter is translate-only: it publishes no `:free` STT model.
    expect(providerSupportsLanguage("openrouter", "stt", "en")).toBe(false);
    // Streaming TTS is not implemented by anyone.
    expect(providerSupportsLanguage("edge", "ttsStream", "en")).toBe(false);
    // Groq claims no streaming route at all, so it is absent from the pipeline
    // rather than being dialled and failing.
    expect(getStreamRoutes().map((r) => r.provider)).not.toContain("groq");
  });

  test("refuses an unknown provider", () => {
    expect(providerSupportsLanguage("nope", "stt", "en")).toBe(false);
    expect(providerSupportsLanguage("nope", "tts", "en")).toBe(false);
  });

  test("leaves a transcription provider for every OFFERED language", () => {
    // Scoped to the offered tier. The catalog still contains languages nothing
    // transcribes (Scottish Gaelic, Cherokee, ...) and those are simply not
    // offered — iterating the catalog here would demand coverage we never had.
    const orphaned = new Set(unsupportedLanguages("stt"));
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const pool = [
        "witai",
        "groq",
        "cloudflare",
        "gladia",
        "cohere",
        "deepgram",
        "assemblyai",
        "elevenlabs",
      ].filter((p) => providerSupportsLanguage(p, "stt", code));
      if (orphaned.has(code)) {
        expect(pool.length, `"${code}" should be an orphan`).toBe(0);
      } else {
        expect(pool.length, `no STT provider for "${code}"`).toBeGreaterThan(0);
      }
    }
  });

  test("leaves a synthesis provider for every OFFERED language", () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const pool = ["gemini", "edge", "deepgram", "witai"].filter((p) =>
        providerSupportsLanguage(p, "tts", code),
      );
      expect(pool.length, `no TTS provider for "${code}"`).toBeGreaterThan(0);
    }
  });

  test("gives every OFFERED language a streaming route", () => {
    // A client asking to stream an unsupported language must be told rather than
    // left to fail on attach, so the no-route set is asserted rather than assumed
    // to be just Cantonese.
    // The offered tier clears the streaming gap too, so nothing offered can fail
    // on attach. Cantonese is unstreamable and therefore not offered.
    const unroutable = new Set(unsupportedStreamLanguages());
    expect(unroutable.has("yue")).toBe(false);
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      const routes = streamRoutesFor(code);
      if (unroutable.has(code)) {
        expect(routes, `"${code}" unexpectedly has a streaming route`).toEqual(
          [],
        );
      } else {
        expect(
          routes.length,
          `no streaming route for "${code}"`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("only offers the pipeline routes a module has claimed", () => {
    const ids = getStreamRoutes().map((r) => r.id);
    expect(ids).toContain("deepgram-flux-multi");
    expect(ids).toContain("gladia-solaria");
    expect(ids).toContain("witai");
  });
});
