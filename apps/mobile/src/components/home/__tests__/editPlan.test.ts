import { describe, expect, it } from "vitest";

import { planEdit } from "@/components/home/editPlan";

const BASE = { transcript: "hello there", translation: "hola" };

describe("planEdit", () => {
  it("does nothing when neither document changed", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "hello there",
        draftTranslation: "hola",
      }),
    ).toEqual({
      kind: "unchanged",
    });
  });

  it("speaks a corrected translation without translating it", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "hello there",
        draftTranslation: "hola, qué tal",
      }),
    ).toEqual({ kind: "speak", text: "hola, qué tal" });
  });

  it("re-translates a corrected transcript so the audio follows it", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "hello, there",
        draftTranslation: "hola",
      }),
    ).toEqual({ kind: "retranslate", text: "hello, there" });
  });

  it("honours a typed translation even when the transcript also changed", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "hello, there",
        draftTranslation: "hola, qué tal",
      }),
    ).toEqual({ kind: "speak", text: "hola, qué tal" });
  });

  it("speaks the transcript directly when there is no translation", () => {
    expect(
      planEdit({
        transcript: "hello",
        translation: null,
        draftTranscript: "hello, world",
        draftTranslation: "",
      }),
    ).toEqual({ kind: "speak", text: "hello, world" });
  });

  it("never re-translates the user's own words when nothing was translated", () => {
    const plan = planEdit({
      transcript: "hello",
      translation: null,
      draftTranscript: "hello, world",
      draftTranslation: "",
    });
    expect(plan.kind).not.toBe("retranslate");
  });

  it("treats an emptied translation field as unchanged rather than speaking nothing", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "hello there",
        draftTranslation: "   ",
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("ignores surrounding whitespace", () => {
    expect(
      planEdit({
        ...BASE,
        draftTranscript: "  hello there ",
        draftTranslation: "hola  ",
      }),
    ).toEqual({ kind: "unchanged" });
  });
});
