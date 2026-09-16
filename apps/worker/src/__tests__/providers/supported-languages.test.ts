import { describe, test, expect } from "vitest";
import * as assemblyai from "../../providers/assemblyai";

import * as cloudflare from "../../providers/cloudflare";
import * as cohere from "../../providers/cohere";
import * as deepgram from "../../providers/deepgram";
import * as gladia from "../../providers/gladia";
import * as groq from "../../providers/groq";
import * as witai from "../../providers/witai";
import { ALL_LANGUAGES, toWhisperCode } from "../../services/languages";
import { LANGUAGES } from "@ekwe/shared";

describe("all transcription providers export supportedLanguages", () => {
  const providers: [string, ReadonlySet<string>][] = [
    ["assemblyai", assemblyai.supportedLanguages],

    ["cloudflare", cloudflare.supportedLanguages],
    ["cohere", cohere.supportedLanguages],
    ["deepgram", deepgram.supportedLanguages],
    ["gladia", gladia.supportedLanguages],
    ["groq", groq.supportedLanguages],
    ["witai", witai.supportedLanguages],
  ];

  for (const [name, langs] of providers) {
    test(`${name} exports supportedLanguages`, () => {
      expect(langs).toBeInstanceOf(Set);
      expect(langs.size).toBeGreaterThan(0);
    });
  }

  test("witai supportedLanguages includes ig, yo, ha", () => {
    expect(witai.supportedLanguages.has("ig")).toBe(true);
    expect(witai.supportedLanguages.has("yo")).toBe(true);
    expect(witai.supportedLanguages.has("ha")).toBe(true);
  });

  test("witai supportedLanguages includes Cherokee (ci) and Sicilian (ck)", () => {
    expect(witai.supportedLanguages.has("ci")).toBe(true);
    expect(witai.supportedLanguages.has("ck")).toBe(true);
  });

  test("witai supportedLanguages has correct size (132 codes)", () => {
    expect(witai.supportedLanguages.size).toBe(132);
  });

  test("cohere has exactly 14 supported languages", () => {
    expect(cohere.supportedLanguages.size).toBe(14);
    expect(cohere.supportedLanguages.has("en")).toBe(true);
    expect(cohere.supportedLanguages.has("ig")).toBe(false);
  });

  test("assemblyai streaming only supports en", async () => {
    const { ASSEMBLYAI_STREAM_LANGUAGES } =
      await import("../../services/languages");
    expect(ASSEMBLYAI_STREAM_LANGUAGES.size).toBe(1);
    expect(ASSEMBLYAI_STREAM_LANGUAGES.has("en")).toBe(true);
  });

  test("streaming pipeline includes witai with correct languages", async () => {
    const { STREAM_STT_LANGUAGES } = await import("../../services/languages");
    expect(STREAM_STT_LANGUAGES.witai).toBeDefined();
    expect(STREAM_STT_LANGUAGES.witai.has("ig")).toBe(true);
    expect(STREAM_STT_LANGUAGES.witai.has("en")).toBe(true);
  });

  test("toWhisperCode translates Javanese jv -> jw and Norwegian Bokmål nb -> no", () => {
    expect(toWhisperCode("jv")).toBe("jw");
    expect(toWhisperCode("nb")).toBe("no");
    expect(toWhisperCode("en")).toBe("en");
    expect(toWhisperCode("yue")).toBe("yue");
  });

  test("ALL_LANGUAGES (Whisper gate) uses canonical jv and nb codes", () => {
    expect(ALL_LANGUAGES.has("jv")).toBe(true);
    expect(ALL_LANGUAGES.has("jw")).toBe(false);
    expect(ALL_LANGUAGES.has("nb")).toBe(true);
    expect(ALL_LANGUAGES.has("no")).toBe(true);
  });

  test("ALL_LANGUAGES stays a subset of the shared product language list", () => {
    const shared = new Set(LANGUAGES.map((l) => l.code));
    for (const code of ALL_LANGUAGES) {
      expect(
        shared.has(code),
        `${code} missing from @ekwe/shared LANGUAGES`,
      ).toBe(true);
    }
  });
});
