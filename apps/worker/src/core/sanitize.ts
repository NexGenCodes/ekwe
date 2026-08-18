/**
 * ─── Prompt Injection Sanitization ──────────────────────────────
 * Strips common prompt injection markers that attempt to override LLM
 * system prompts. These are stripped silently — the user still gets a
 * translation, just without the injected payload.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
  /disregard\s+your\s+(instructions?|prompts?|rules?)/gi,
  /you\s+are\s+(now|a|an)\s+/gi,
  /act\s+as\s+(a|an)\s+/gi,
  /pretend\s+(you('re|\s+are)\s+)/gi,
  /system\s*prompt/gi,
  /system\s+message/gi,
  /developer\s+message/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<system>/gi,
  /<\\?system\\?>/gi,
  /(?:now\s+)?(?:output|reply|respond)\s+(?:only\s+)?(?:in\s+)?(?:json|markdown|html)/gi,
  /\[SYS\]/gi,
  /\[\/SYS\]/gi,
  /do\s+not\s+(?:follow|obey)\s+previous/gi,
];

export function sanitizeTranslationText(text: string): string {
  // Strip Unicode bidi control characters (can be used to spoof/hide injected text).
  let sanitized = text.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, "");
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.replace(/\s{3,}/g, "  ").trim();
}