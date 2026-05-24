import { describe, test, expect, vi } from 'vitest';
import { isHallucination, sanitizeKey, getClientHeaders, fetchWithTimeout, abortableDelay } from '../src/utils';
import { mockEnv, jsonResponse, mockFetch } from './setup';

// ─── sanitizeKey ───────────────────────────────────────────────────

describe('sanitizeKey', () => {
  test('passes valid key through', () => {
    expect(sanitizeKey('valid-key-123')).toBe('valid-key-123');
  });

  test('strips non-printable chars', () => {
    expect(sanitizeKey('key\x00null')).toBe('keynull');
  });

  test('returns empty for empty string', () => {
    expect(sanitizeKey('')).toBe('');
  });

  test('returns empty for null', () => {
    expect(sanitizeKey(null)).toBe('');
  });

  test('returns empty for non-string', () => {
    expect(sanitizeKey(123)).toBe('');
  });

  test('trims whitespace', () => {
    expect(sanitizeKey('  key-123  ')).toBe('key-123');
  });
});

// ─── isHallucination ───────────────────────────────────────────────

describe('isHallucination', () => {
  test('empty text is hallucination', () => {
    expect(isHallucination('')).toBe(true);
    expect(isHallucination('   ')).toBe(true);
  });

  test('"thanks for watching" pattern', () => {
    expect(isHallucination('Thanks for watching')).toBe(true);
    expect(isHallucination('thank you for watching')).toBe(true);
  });

  test('subscribe pattern', () => {
    expect(isHallucination('Please subscribe')).toBe(true);
    expect(isHallucination('like and subscribe')).toBe(true);
  });

  test('bracket patterns', () => {
    expect(isHallucination('[Music]')).toBe(true);
    expect(isHallucination('[Applause]')).toBe(true);
  });

  test('single pronoun/article', () => {
    expect(isHallucination('you')).toBe(true);
    expect(isHallucination('the')).toBe(true);
    expect(isHallucination('i')).toBe(true);
  });

  test('repeated phrase', () => {
    expect(isHallucination('abcdeabcdeabcde')).toBe(true);
  });

  test('WPS too high', () => {
    const words = Array.from({ length: 35 }, (_, i) => `word${i}`).join(' ');
    expect(isHallucination(words, 5000)).toBe(true);
  });

  test('WPS too low for >3 words', () => {
    expect(isHallucination('hello how are you', 30000)).toBe(true);
  });

  test('normal speech passes', () => {
    expect(isHallucination('hello how are you today i am doing great', 5000)).toBe(false);
  });

  test('normal text without duration passes', () => {
    expect(isHallucination('This is a perfectly normal sentence.')).toBe(false);
  });

  test('short text without duration passes', () => {
    expect(isHallucination('hello')).toBe(false);
  });
});

// ─── getClientHeaders ─────────────────────────────────────────────

describe('getClientHeaders', () => {
  test('returns Accept-Language by default', () => {
    const h = getClientHeaders();
    expect(h['Accept-Language']).toBe('en-US,en;q=0.9');
    expect(h['User-Agent']).toBeFalsy();
    expect(h['X-Forwarded-For']).toBeFalsy();
  });

  test('forwards headers from request when provided', () => {
    const req = new Request('http://test', {
      headers: {
        'X-Forwarded-For': '1.2.3.4',
        'X-Real-IP': '5.6.7.8',
      },
    });
    const h = getClientHeaders(req);
    expect(h['X-Forwarded-For']).toBe('1.2.3.4');
    expect(h['X-Real-IP']).toBe('5.6.7.8');
    expect(h['Accept-Language']).toBe('en-US,en;q=0.9');
  });
});

// ─── fetchWithTimeout ──────────────────────────────────────────────

describe('fetchWithTimeout', () => {
  test('resolves on success before timeout', async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const res = await fetchWithTimeout(
      'https://mock.test/200',
      { method: 'GET' },
      5000,
      new AbortController().signal,
    );
    expect(res.ok).toBe(true);
  });

  test('aborts on client signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithTimeout('https://httpstat.us/200', { method: 'GET' }, 5000, controller.signal),
    ).rejects.toThrow();
  });
});

// ─── abortableDelay ────────────────────────────────────────────────

describe('abortableDelay', () => {
  test('resolves after delay', async () => {
    const start = Date.now();
    await abortableDelay(10, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(5);
  });

  test('throws on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(1000, controller.signal)).rejects.toThrow('CLIENT_ABORTED');
  });
});

// ─── rotateKeys (integration with mock) ────────────────────────────

describe('rotateKeys', () => {
  test('returns first 2xx response', async () => {
    const { rotateKeys, hashKey } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'valid-key-1-abcde', GROQ_KEY_2: 'valid-key-2-abcde' });

    let callCount = 0;
    const result = await rotateKeys(env, 'GROQ_KEY_', async () => {
      callCount++;
      return jsonResponse({ ok: true });
    }, new AbortController().signal);

    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(callCount).toBe(1);
  });

  test('skips blacklisted keys', async () => {
    const { rotateKeys, hashKey } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'blacklisted-key-abc', GROQ_KEY_2: 'valid-key-2-abcde' });

    const hash1 = await hashKey('blacklisted-key-abc');
    await env.EKWE_KV.put(`blacklist:groq_key:${hash1}`, 'true', { expirationTtl: 60 });

    let blacklistKeyAttempted = false;
    const result = await rotateKeys(env, 'GROQ_KEY_', async (key) => {
      if (key === 'blacklisted-key-abc') blacklistKeyAttempted = true;
      return jsonResponse({ ok: true });
    }, new AbortController().signal);

    expect(blacklistKeyAttempted).toBe(false);
    expect(result).not.toBeNull();
  });

  test('blacklists 429 keys', async () => {
    const { rotateKeys, hashKey } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'rate-limited-key-abc', GROQ_KEY_2: 'valid-key-2-abcde' });

    await rotateKeys(env, 'GROQ_KEY_', async (key) => {
      if (key === 'rate-limited-key-abc') return jsonResponse({}, 429);
      return jsonResponse({ ok: true });
    }, new AbortController().signal);

    expect(env.EKWE_KV.put).toHaveBeenCalledWith(
      expect.stringContaining('blacklist:groq_key:'),
      'true',
      expect.objectContaining({ expirationTtl: 60 }),
    );
  });

  test('skips 4xx and 5xx errors', async () => {
    const { rotateKeys } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'fail-key-1-abcde', GROQ_KEY_2: 'valid-key-2-abcde' });

    let callCount = 0;
    const result = await rotateKeys(env, 'GROQ_KEY_', async (key) => {
      callCount++;
      if (key === 'fail-key-1-abcde') return jsonResponse({}, 400);
      return jsonResponse({ ok: true });
    }, new AbortController().signal);

    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThanOrEqual(2);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  test('returns null when all keys fail', async () => {
    const { rotateKeys } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'fail-key-1-abcde', GROQ_KEY_2: 'fail-key-2-abcde' });

    const result = await rotateKeys(env, 'GROQ_KEY_', async () => jsonResponse({}, 500), new AbortController().signal);
    expect(result).toBeNull();
  });

  test('throws on abort', async () => {
    const { rotateKeys } = await import('../src/utils');
    const env = mockEnv({ GROQ_KEY_1: 'valid-key-1-abcde' });
    const controller = new AbortController();
    controller.abort();

    await expect(
      rotateKeys(env, 'GROQ_KEY_', async () => jsonResponse({}), controller.signal),
    ).rejects.toThrow('CLIENT_ABORTED');
  });
});
