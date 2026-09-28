/** A typed translation is the exact wording the user wants spoken, so it wins. */
export type EditPlan =
  | { kind: "unchanged" }
  | { kind: "speak"; text: string }
  | { kind: "retranslate"; text: string };

export function planEdit(args: {
  draftTranscript: string;
  draftTranslation: string;
  transcript: string;
  translation: string | null;
}): EditPlan {
  const transcript = args.transcript.trim();
  const translation = args.translation?.trim() ?? "";
  const draftTranscript = args.draftTranscript.trim();
  const draftTranslation = args.draftTranslation.trim();

  if (draftTranscript === transcript && draftTranslation === translation) {
    return { kind: "unchanged" };
  }

  // No translation on screen: the result is the transcript, so it is spoken
  // directly. Passing a source language here would machine-translate the user's
  // own words.
  if (!translation) {
    return draftTranscript
      ? { kind: "speak", text: draftTranscript }
      : { kind: "unchanged" };
  }

  if (draftTranslation !== translation) {
    return draftTranslation
      ? { kind: "speak", text: draftTranslation }
      : { kind: "unchanged" };
  }
  return draftTranscript
    ? { kind: "retranslate", text: draftTranscript }
    : { kind: "unchanged" };
}
