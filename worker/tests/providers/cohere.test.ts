import { describe, test, expect } from 'vitest';
import * as cohere from '../../src/providers/cohere';
import { mockEnv, jsonResponse, mockFetch, mockFetchReset, mockSignal } from '../setup';

describe('Cohere provider', () => {
  afterEach(() => { mockFetchReset(); });

  test('returns translation on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('api.cohere.ai')) {
        return jsonResponse({ message: { content: [{ text: 'Bonjour le monde' }] } });
      }
      return jsonResponse({}, 404);
    });

    const result = await cohere.translate('Hello world', 'French', 'English', mockEnv(), mockSignal());
    expect(result).not.toBeNull();
    expect(result!.translation).toBe('Bonjour le monde');
    expect(result!.provider).toBe('cohere-command-r-plus');
  });

  test('returns null on HTTP error', async () => {
    mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const result = await cohere.translate('Hello', 'French', 'English', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('returns null on empty message content', async () => {
    mockFetch(async () => jsonResponse({ message: { content: [] } }));
    const result = await cohere.translate('Hello', 'French', 'English', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('returns null on missing message', async () => {
    mockFetch(async () => jsonResponse({}));
    const result = await cohere.translate('Hello', 'French', 'English', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });
});
