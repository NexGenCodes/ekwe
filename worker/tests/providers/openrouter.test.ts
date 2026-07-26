import { describe, test, expect } from 'vitest';
import * as openrouter from '../../src/providers/openrouter';
import {
  mockEnv,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('OpenRouter provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  test('returns translation on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('openrouter.ai')) {
        return jsonResponse({
          choices: [{ message: { content: 'Hola mundo' } }],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await openrouter.translate(
      'Hello world',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe('Hola mundo');
    expect(result!.provider).toBe('openrouter');
  });

  test('returns null when key is missing', async () => {
    const env = mockEnv({ OPENROUTER_KEY: '' });
    const result = await openrouter.translate(
      'Hello',
      'Spanish',
      'English',
      env,
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on HTTP error', async () => {
    mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const result = await openrouter.translate(
      'Hello',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on empty choices', async () => {
    mockFetch(async () => jsonResponse({ choices: [] }));
    const result = await openrouter.translate(
      'Hello',
      'Spanish',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
