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
 * Strips bidi overrides and chat-template delimiters before sending to provider.
 */
export function sanitizeTranslationText(text: string): string {
  return collapse(stripBidiControls(text).replace(STRUCTURAL_DELIMITERS, ""));
}

/**
 * Strips structural delimiters from provider output before returning to client.
 */
export function sanitizeProviderOutput(text: string): string {
  return sanitizeTranslationText(text);
}
