import { describe, test, expect } from "vitest";
import * as assemblyai from "../src/providers/assemblyai";

import * as cloudflare from "../src/providers/cloudflare";
import * as cohere from "../src/providers/cohere";
import * as deepgram from "../src/providers/deepgram";
import * as gladia from "../src/providers/gladia";
import * as groq from "../src/providers/groq";
import * as witai from "../src/providers/witai";
import { ALL_LANGUAGES, toWhisperCode } from "../src/languages";

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
    const { ASSEMBLYAI_STREAM_LANGUAGES } = await import("../src/languages");
    expect(ASSEMBLYAI_STREAM_LANGUAGES.size).toBe(1);
    expect(ASSEMBLYAI_STREAM_LANGUAGES.has("en")).toBe(true);
  });

  test("streaming pipeline includes witai with correct languages", async () => {
    const { STREAM_STT_LANGUAGES } = await import("../src/languages");
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
});
