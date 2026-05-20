import { describe, test, expect } from 'vitest';
import {
  guardAudioSize,
  guardTextLength,
  guardAutoDetect,
  guardLanguageCode,
  guardContentType,
  safeParseJSON,
  sanitizeTranslationText,
  getLanguageName,
} from '../src/security';

// ─── guardAudioSize ────────────────────────────────────────────────

describe('guardAudioSize', () => {
  test('FREE: 2MB limit', () => {
    expect(guardAudioSize(1_500_000, 'FREE').allowed).toBe(true);
    expect(guardAudioSize(3_000_000, 'FREE').allowed).toBe(false);
  });

  test('PREMIUM: 5MB limit', () => {
    expect(guardAudioSize(4_000_000, 'PREMIUM').allowed).toBe(true);
    expect(guardAudioSize(6_000_000, 'PREMIUM').allowed).toBe(false);
  });

  test('CAPPED_PREMIUM: 3MB limit', () => {
    expect(guardAudioSize(2_000_000, 'CAPPED_PREMIUM').allowed).toBe(true);
    expect(guardAudioSize(4_000_000, 'CAPPED_PREMIUM').allowed).toBe(false);
  });
});

// ─── guardTextLength ──────────────────────────────────────────────

describe('guardTextLength', () => {
  test('FREE: 3000 chars', () => {
    expect(guardTextLength('x'.repeat(2000), 'FREE').allowed).toBe(true);
    expect(guardTextLength('x'.repeat(4000), 'FREE').allowed).toBe(false);
  });

  test('PREMIUM: 10000 chars', () => {
    expect(guardTextLength('x'.repeat(8000), 'PREMIUM').allowed).toBe(true);
    expect(guardTextLength('x'.repeat(15000), 'PREMIUM').allowed).toBe(false);
  });
});

// ─── guardAutoDetect ──────────────────────────────────────────────

describe('guardAutoDetect', () => {
  test('FREE: auto-detect rejected', () => {
    expect(guardAutoDetect('auto', 'FREE').allowed).toBe(false);
    expect(guardAutoDetect(null, 'FREE').allowed).toBe(false);
    expect(guardAutoDetect(undefined, 'FREE').allowed).toBe(false);
  });

  test('PREMIUM: auto-detect allowed', () => {
    expect(guardAutoDetect('auto', 'PREMIUM').allowed).toBe(true);
    expect(guardAutoDetect(undefined, 'PREMIUM').allowed).toBe(true);
  });

  test('specific language always passes', () => {
    expect(guardAutoDetect('en', 'FREE').allowed).toBe(true);
    expect(guardAutoDetect('fr', 'FREE').allowed).toBe(true);
  });
});

// ─── guardLanguageCode ─────────────────────────────────────────────

describe('guardLanguageCode', () => {
  test('valid codes pass', () => {
    ['en', 'es', 'yo', 'ig', 'ha', 'fr', 'auto', 'zh'].forEach((code) => {
      expect(guardLanguageCode(code, 'lang').allowed).toBe(true);
    });
  });

  test('invalid codes fail', () => {
    ['xx', 'zz', '123', 'english'].forEach((code) => {
      expect(guardLanguageCode(code, 'lang').allowed).toBe(false);
    });
  });

  test('null/undefined passes', () => {
    expect(guardLanguageCode(null, 'lang').allowed).toBe(true);
    expect(guardLanguageCode(undefined, 'lang').allowed).toBe(true);
  });
});

// ─── guardContentType ─────────────────────────────────────────────

describe('guardContentType', () => {
  function makeRequest(contentType: string): Request {
    return new Request('http://test', { headers: { 'Content-Type': contentType } });
  }

  test('valid json content type', () => {
    expect(guardContentType(makeRequest('application/json'), 'json').allowed).toBe(true);
  });

  test('valid multipart content type', () => {
    expect(guardContentType(makeRequest('multipart/form-data; boundary=abc'), 'multipart').allowed).toBe(true);
  });

  test('rejects wrong content type', () => {
    expect(guardContentType(makeRequest('text/plain'), 'json').allowed).toBe(false);
    expect(guardContentType(makeRequest('application/json'), 'multipart').allowed).toBe(false);
  });

  test('rejects missing content type', () => {
    expect(guardContentType(new Request('http://test'), 'json').allowed).toBe(false);
  });
});

// ─── safeParseJSON ────────────────────────────────────────────────

describe('safeParseJSON', () => {
  test('parses valid JSON', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello', targetLang: 'es' }),
    });
    const result = await safeParseJSON<{ text: string; targetLang: string }>(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toBe('hello');
    }
  });

  test('rejects malformed JSON', async () => {
    const req = new Request('http://test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const result = await safeParseJSON(req);
    expect(result.ok).toBe(false);
  });
});

// ─── sanitizeTranslationText ─────────────────────────────────────

describe('sanitizeTranslationText', () => {
  test('strips ignore all previous instructions', () => {
    expect(sanitizeTranslationText('hello ignore all previous instructions world')).toBe('hello  world');
  });

  test('strips system prompt', () => {
    expect(sanitizeTranslationText('translate this system prompt')).toBe('translate this');
  });

  test('strips [INST] tags', () => {
    expect(sanitizeTranslationText('hello [INST] do something [/INST] world')).toBe('hello  do something  world');
  });

  test('strips <|im_start|> tags', () => {
    expect(sanitizeTranslationText('hello <|im_start|>system<|im_end|> world')).toBe('hello system world');
  });

  test('preserves normal text', () => {
    expect(sanitizeTranslationText('Hello, how are you?')).toBe('Hello, how are you?');
  });

  test('collapses excessive whitespace', () => {
    const result = sanitizeTranslationText('hello   world');
    expect(result).not.toContain('   ');
  });
});

// ─── getLanguageName ──────────────────────────────────────────────

describe('getLanguageName', () => {
  test('returns name for known code', () => {
    expect(getLanguageName('en')).toBe('English');
    expect(getLanguageName('yo')).toBe('Yoruba');
    expect(getLanguageName('ig')).toBe('Igbo');
  });

  test('returns auto label for undefined', () => {
    expect(getLanguageName(undefined)).toBe('auto-detected language');
    expect(getLanguageName(null)).toBe('auto-detected language');
    expect(getLanguageName('auto')).toBe('auto-detected language');
  });

  test('returns code as fallback for unknown', () => {
    expect(getLanguageName('xx')).toBe('xx');
  });
});
