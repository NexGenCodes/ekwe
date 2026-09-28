const BIDI_CONTROLS = /[‪-‮⁦-⁩‎‏]/g;

const STRUCTURAL_DELIMITERS =
  /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|\[SYS\]|\[\/SYS\]|<\\?system\\?>|<\/?system>/gi;

export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}

function collapse(text: string): string {
  return text.replace(/[ \t]{3,}/g, "  ").trim();
}

/**
 * Applied to text on its way to a provider. Only strips characters that never
 * occur in legitimate prose: bidi overrides (which can visually reorder a
 * translation) and chat-template delimiters (the one injection shape that is
 * unambiguous by construction).
 *
 * Matching natural-language phrases such as "ignore previous instructions" was
 * dropped on purpose. It never worked — "disregard earlier directives" and every
 * non-English phrasing walk straight past it — while `/you are a/` mangled
 * ordinary sentences. A blocklist is the wrong control for prompt injection;
 * the provider prompt already delimits user text as a user turn.
 */
export function sanitizeTranslationText(text: string): string {
  return collapse(stripBidiControls(text).replace(STRUCTURAL_DELIMITERS, ""));
}

/**
 * Applied to text on its way back to the client, where a third party's speech
 * may be rendered for someone else. Structural delimiters are stripped so a
 * downstream consumer cannot be made to read provider output as a new turn.
 */
export function sanitizeProviderOutput(text: string): string {
  return sanitizeTranslationText(text);
}
