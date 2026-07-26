import { describe, test, expect } from 'vitest';
import * as mistral from '../../src/providers/mistral';
import {
  mockEnv,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('Mistral provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  test('returns translation on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('api.mistral.ai')) {
        return jsonResponse({
          choices: [{ message: { content: 'Ciao mondo' } }],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await mistral.translate(
      'Hello world',
      'Italian',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe('Ciao mondo');
    expect(result!.provider).toBe('mistral');
  });

  test('returns null on HTTP error', async () => {
    mockFetch(async () => jsonResponse({ error: 'rate limited' }, 429));
    const result = await mistral.translate(
      'Hello',
      'Italian',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on empty choices', async () => {
    mockFetch(async () => jsonResponse({ choices: [] }));
    const result = await mistral.translate(
      'Hello',
      'Italian',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
