import { describe, test, expect } from 'vitest';
import * as gemini from '../../src/providers/gemini';
import {
  mockEnv,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('Gemini provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  test('returns translation on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'Hola mundo' }] } }],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await gemini.translate(
      'Hello world',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe('Hola mundo');
    expect(result!.provider).toBe('gemini-2.5-flash');
  });

  test('returns null on HTTP error', async () => {
    mockFetch(async () =>
      jsonResponse({ error: { message: 'quota exceeded' } }, 429),
    );
    const result = await gemini.translate(
      'Hello',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on empty candidates', async () => {
    mockFetch(async () => jsonResponse({ candidates: [] }));
    const result = await gemini.translate(
      'Hello',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on missing content parts', async () => {
    mockFetch(async () => jsonResponse({ candidates: [{ content: {} }] }));
    const result = await gemini.translate(
      'Hello',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
