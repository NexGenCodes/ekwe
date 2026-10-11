// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import {
  entryAccessibilityLabel,
  entryLanguageLabel,
  formatEntryDuration,
  originLabel,
  originProvenanceLabel,
  resolveOrigin,
} from "@/utils/historyOrigin";
import type { HistoryEntry } from "@/store";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    captureId: "cap-1",
    origin: "echo",
    input: "audio",
    sourceLang: "es",
    targetLang: "fr",
    transcript: "hola mundo",
    translation: "bonjour le monde",
    transliteration: null,
    timestamp: 1_700_000_000_000,
    duration: 14,
    sourceApp: "com.whatsapp",
    voiceId: null,
    sttProvider: "deepgram",
    mtProvider: "gemini",
    type: "translation",
    ...overrides,
  };
}

describe("resolveOrigin", () => {
  it("prefers a real stored origin", () => {
    expect(resolveOrigin(entry({ origin: "speech-studio" }))).toBe(
      "speech-studio",
    );
    expect(resolveOrigin(entry({ origin: "orb" }))).toBe("orb");
  });

  it("files anything unrecognised under echo", () => {
    // No source_app derivation survives: the column is NOT NULL DEFAULT
    // 'echo', so a sentinel is all an unrecognised row can carry.
    const legacy = entry({
      origin: "nonsense" as never,
      sourceApp: "ekwe-home",
    });
    expect(resolveOrigin(legacy)).toBe("echo");
  });
});

describe("originProvenanceLabel", () => {
  it("names the app for echo", () => {
    expect(originProvenanceLabel(entry())).toBe("Echo · WhatsApp");
  });

  it("names the app for orb", () => {
    expect(
      originProvenanceLabel(
        entry({ origin: "orb", sourceApp: "com.zhiliaoapp.musically" }),
      ),
    ).toBe("Orb · TikTok");
  });

  it("names the voice by descriptor, with the tier prefix dropped", () => {
    // The surface already names itself, so repeating the tier would read
    // "Studio · Studio · Clear".
    expect(
      originProvenanceLabel(
        entry({
          origin: "speech-studio",
          sourceApp: null,
          voiceId: "standard",
        }),
      ),
    ).toBe("Studio · Standard");
    expect(
      originProvenanceLabel(
        entry({ origin: "speech-studio", sourceApp: null, voiceId: "studio" }),
      ),
    ).toBe("Studio · Clear");
    expect(
      originProvenanceLabel(
        entry({
          origin: "speech-studio",
          sourceApp: null,
          voiceId: "studio-2",
        }),
      ),
    ).toBe("Studio · Warm");
  });

  it("omits the voice when the row has none recorded", () => {
    expect(
      originProvenanceLabel(
        entry({ origin: "speech-studio", sourceApp: null, voiceId: null }),
      ),
    ).toBe("Studio");
  });

  it("falls back to the origin alone when the app is unknown", () => {
    expect(originProvenanceLabel(entry({ sourceApp: null }))).toBe("Echo");
  });

  it("does not render a retired placeholder as an app name", () => {
    // These all used to reach formatSourceApp, which turned "ios" into "Audio"
    // and would otherwise have shown a bare platform name as if it were an
    // app the audio came from.
    for (const placeholder of ["ios", "unknown", "ekwe", "shared"]) {
      expect(originProvenanceLabel(entry({ sourceApp: placeholder }))).toBe(
        "Echo",
      );
    }
  });
});

describe("originLabel", () => {
  it("returns the display name", () => {
    expect(originLabel("speech-studio")).toBe("Studio");
    expect(originLabel("echo")).toBe("Echo");
    expect(originLabel("orb")).toBe("Orb");
  });
});

describe("entryLanguageLabel", () => {
  it("shows the pair when translated", () => {
    expect(entryLanguageLabel(entry())).toBe("ES → FR");
  });

  it("shows only the source when untranslated", () => {
    expect(entryLanguageLabel(entry({ translation: null }))).toBe("ES");
  });

  it("treats a translation identical to the transcript as untranslated", () => {
    expect(
      entryLanguageLabel(entry({ transcript: "hola", translation: "hola" })),
    ).toBe("ES");
  });
});

describe("formatEntryDuration", () => {
  it("returns null for a capture with no audio", () => {
    expect(formatEntryDuration(0)).toBeNull();
  });

  it("formats seconds, minutes, and hours", () => {
    expect(formatEntryDuration(14)).toBe("14s");
    expect(formatEntryDuration(60)).toBe("1m");
    expect(formatEntryDuration(95)).toBe("1m 35s");
    expect(formatEntryDuration(3600)).toBe("1h");
    expect(formatEntryDuration(3900)).toBe("1h 5m");
  });
});

describe("entryAccessibilityLabel", () => {
  it("reads the first line, then provenance, then languages", () => {
    expect(
      entryAccessibilityLabel(entry({ transcript: "hola\nsegunda linea" })),
    ).toBe("hola. Echo, from WhatsApp. Spanish translated to French.");
  });

  it("does not name a placeholder as the source app", () => {
    expect(entryAccessibilityLabel(entry({ sourceApp: "ios" }))).toBe(
      "hola mundo. Echo. Spanish translated to French.",
    );
  });

  it("does not claim a translation when there is none", () => {
    expect(entryAccessibilityLabel(entry({ translation: null }))).toBe(
      "hola mundo. Echo, from WhatsApp. Spanish.",
    );
  });

  it("falls back when there is no transcript", () => {
    expect(
      entryAccessibilityLabel(entry({ transcript: "", sourceApp: null })),
    ).toBe("Voice note. Echo. Spanish translated to French.");
  });
});
