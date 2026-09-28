import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EDGE_LOCALE_CODES,
  extractAudioSegment,
  voices,
} from "@/providers/edge";
import { LANGUAGE_CODES } from "@ekwe/shared/languages";
import {
  LANGUAGE_CAPABILITIES,
  type LanguageCapabilitySpec,
} from "@ekwe/shared/languageCapabilities";

interface FrameFixture {
  frame: {
    byteLength: number;
    base64: string;
    headerLength: number;
    headerText: string;
    bodyByteLength: number;
    bodyFirstBytesHex: string;
  };
}

const fixture: FrameFixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/edge-tts-audio-frame.fixture.json", import.meta.url),
    ),
    "utf8",
  ),
) as FrameFixture;

const frameBytes = (): Uint8Array =>
  new Uint8Array(Buffer.from(fixture.frame.base64, "base64"));

/** Rebuilds a frame from a header map and a body, the way the service sends it. */
function buildFrame(headers: string[], body: Uint8Array): Uint8Array {
  const text = headers.join("\r\n");
  // headerLength counts its own two-byte prefix, so text + 2.
  const headerLength = text.length + 2;
  // headerLength already includes the two-byte prefix it is stored in.
  const out = new Uint8Array(headerLength + 2 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, headerLength);
  out.set(new TextEncoder().encode(text), 2);
  out[headerLength] = 0x0d;
  out[headerLength + 1] = 0x0a;
  out.set(body, headerLength + 2);
  return out;
}

describe("Edge audio frame parsing", () => {
  test("extracts the body from a real recorded frame", () => {
    const body = extractAudioSegment(frameBytes());

    expect(body).not.toBeNull();
    expect(body!.length).toBe(fixture.frame.bodyByteLength);
    expect(body!.length).toBe(720);
  });

  test("body starts at the MP3 frame sync, not a length field", () => {
    const body = extractAudioSegment(frameBytes())!;

    // `ff f3` is an MPEG audio frame sync. Reading it as a uint16 would give
    // 65523 and overshoot the frame — the failure the old parser hit.
    expect(Array.from(body.subarray(0, 2))).toEqual([0xff, 0xf3]);
    expect((body[0] << 8) | body[1]).toBe(0xfff3);
    expect(0xfff3).toBeGreaterThan(frameBytes().length);
  });

  test("header length counts its own two-byte prefix", () => {
    const data = frameBytes();

    expect((data[0] << 8) | data[1]).toBe(128);
    // Body begins at headerLength + 2, so the header text is 126 bytes.
    const headerText = new TextDecoder().decode(data.subarray(2, 128));
    expect(headerText).toBe(fixture.frame.headerText);
    expect(headerText).toContain("Path:audio");
    expect(headerText).toContain("Content-Type:audio/mpeg");
  });

  test("synthesises the same body length for a rebuilt frame", () => {
    const payload = Uint8Array.from({ length: 400 }, (_, i) => i & 0xff);
    const data = buildFrame(
      [
        "X-RequestId:0123456789abcdef0123456789abcdef",
        "Content-Type:audio/mpeg",
        "Path:audio",
      ],
      payload,
    );

    const body = extractAudioSegment(data);

    expect(body).not.toBeNull();
    expect(Array.from(body!)).toEqual(Array.from(payload));
  });

  test("ignores a non-audio path", () => {
    const data = buildFrame(
      [
        "X-RequestId:abc",
        "Content-Type:application/json",
        "Path:audio.metadata",
      ],
      Uint8Array.from({ length: 32 }, () => 7),
    );

    expect(extractAudioSegment(data)).toBeNull();
  });

  test("ignores a non-mpeg content type", () => {
    const data = buildFrame(
      ["X-RequestId:abc", "Content-Type:audio/ogg", "Path:audio"],
      Uint8Array.from({ length: 32 }, () => 7),
    );

    expect(extractAudioSegment(data)).toBeNull();
  });

  test("returns null for an empty body", () => {
    const data = buildFrame(
      ["X-RequestId:abc", "Content-Type:audio/mpeg", "Path:audio"],
      new Uint8Array(0),
    );

    expect(extractAudioSegment(data)).toBeNull();
  });

  test("tolerates truncated and degenerate input without throwing", () => {
    const full = frameBytes();

    for (const len of [0, 1, 2, 3, 4, 8, 64, 129, 130, full.length - 1]) {
      expect(() => extractAudioSegment(full.subarray(0, len))).not.toThrow();
    }

    // A declared length past the end of the frame must not index out of range.
    expect(
      extractAudioSegment(Uint8Array.from([0xff, 0xff, 0x41, 0x3a])),
    ).toBeNull();
    // A length below the two-byte prefix is malformed.
    expect(
      extractAudioSegment(Uint8Array.from([0x00, 0x01, 0x41, 0x3a])),
    ).toBeNull();
  });
});

describe("Edge voice catalogue", () => {
  const locales = [
    "af",
    "am",
    "ar",
    "az",
    "bg",
    "bn",
    "bs",
    "ca",
    "cs",
    "cy",
    "da",
    "de",
    "el",
    "en",
    "es",
    "et",
    "fa",
    "fi",
    "fr",
    "ga",
    "gl",
    "gu",
    "he",
    "hi",
    "hr",
    "hu",
    "id",
    "is",
    "it",
    "ja",
    "jv",
    "ka",
    "kk",
    "km",
    "kn",
    "ko",
    "lo",
    "lt",
    "lv",
    "mk",
    "ml",
    "mn",
    "mr",
    "ms",
    "mt",
    "my",
    "nb",
    "ne",
    "nl",
    "no",
    "pl",
    "ps",
    "pt",
    "ro",
    "ru",
    "si",
    "sk",
    "sl",
    "so",
    "sq",
    "sr",
    "su",
    "sv",
    "sw",
    "ta",
    "te",
    "th",
    "tl",
    "tr",
    "uk",
    "ur",
    "uz",
    "vi",
    "yue",
    "zh",
    "zu",
  ];

  test.each(locales)("%s resolves voices for both genders", (locale) => {
    expect(voices("female", locale).length).toBeGreaterThan(0);
    expect(voices("male", locale).length).toBeGreaterThan(0);
  });

  test("voices are well-formed short names the service accepts", () => {
    for (const locale of locales) {
      for (const gender of ["female", "male"] as const) {
        for (const voice of voices(gender, locale)) {
          expect(voice).toMatch(
            /^[a-z]{2,}-[A-Z]{2,}(-[A-Z]{2,})?-[A-Za-z]+Neural$/,
          );
        }
      }
    }
  });

  test("unknown locale falls back rather than returning nothing", () => {
    expect(voices("female", "qq").length).toBeGreaterThan(0);
    expect(voices(undefined, "qq").length).toBeGreaterThan(0);
  });

  test("multilingual voices sit at index 0 so failover keeps the persona", () => {
    // The slot pools treat index 0 as Clear and index 1 as Warm. A locale with a
    // single voice must not shift a later entry into the Clear slot.
    expect(voices("female", "en")[0]).toBe("en-US-AvaMultilingualNeural");
    expect(voices("male", "en")[0]).toBe("en-US-AndrewMultilingualNeural");
    expect(voices("female", "en")[1]).toBe("en-US-EmmaMultilingualNeural");
  });
});

describe("Edge language declaration", () => {
  const edgeTtsSpec = (): LanguageCapabilitySpec => {
    const spec = LANGUAGE_CAPABILITIES.edge.tts;
    if (!spec) throw new Error("edge must declare tts");
    return spec;
  };

  test("matches the locales the provider actually has voices for", () => {
    // The shared `native` list is hand-maintained. If Edge gains or loses a
    // locale, this is the assertion that notices before a language is promised
    // an authored voice it does not have.
    const declared = [...(edgeTtsSpec().native ?? [])].sort();
    const actual = [...EDGE_LOCALE_CODES].sort();
    expect(declared).toEqual(actual);
  });

  test("claims the whole catalog but only 76 authored voices", () => {
    // Edge accepts any language; a locale with no voice falls back to the
    // English multilingual one, which is a real answer rather than a failure.
    const spec = edgeTtsSpec();
    const native = spec.native ?? [];
    expect(spec.unbounded).toBeUndefined();
    expect(spec.codes).toHaveLength(LANGUAGE_CODES.length);
    expect(native).toHaveLength(76);
    expect(native.length).toBeLessThan(spec.codes.length);
  });
});
