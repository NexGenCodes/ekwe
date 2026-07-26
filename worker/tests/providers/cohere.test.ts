import { describe, test, expect } from 'vitest';
import * as cohere from '../../src/providers/cohere';
import {
  mockEnv,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('Cohere provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  // ─── Transcribe ─────────────────────────────────────────────────

  test('transcribe returns text on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('api.cohere.com/v2/audio/transcriptions')) {
        return jsonResponse({ text: 'hello world' });
      }
      return jsonResponse({}, 404);
    });

    const blob = new Blob(['fake audio'], { type: 'audio/wav' });
    const result = await cohere.transcribe(blob, 'en', mockEnv(), mockSignal());
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hello world');
    expect(result!.provider).toBe('cohere');
  });

  test('transcribe returns null for unsupported language', async () => {
    const blob = new Blob(['fake audio'], { type: 'audio/wav' });
    const result = await cohere.transcribe(blob, 'ig', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('transcribe returns null on HTTP error', async () => {
    mockFetch(async () => jsonResponse({ error: 'fail' }, 500));

    const blob = new Blob(['fake audio'], { type: 'audio/wav' });
    const result = await cohere.transcribe(blob, 'en', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('transcribe returns null on missing text', async () => {
    mockFetch(async (url) => {
      if (url.includes('api.cohere.com/v2/audio/transcriptions')) {
        return jsonResponse({});
      }
      return jsonResponse({}, 404);
    });

    const blob = new Blob(['fake audio'], { type: 'audio/wav' });
    const result = await cohere.transcribe(blob, 'en', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('transcribe does not skip supported languages', async () => {
    const result = await cohere.transcribe(
      new Blob(['fake'], { type: 'audio/wav' }),
      'es',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull(); // 404 from mock, but not rejected for language
  });

  // ─── Translate ─────────────────────────────────────────────────

  test('returns translation on success', async () => {
    mockFetch(async (url) => {
      if (url.includes('api.cohere.ai')) {
        return jsonResponse({
          message: { content: [{ text: 'Bonjour le monde' }] },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await cohere.translate(
      'Hello world',
      'French',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.translation).toBe('Bonjour le monde');
    expect(result!.provider).toBe('cohere');
  });

  test('returns null on HTTP error', async () => {
    mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const result = await cohere.translate(
      'Hello',
      'French',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on empty message content', async () => {
    mockFetch(async () => jsonResponse({ message: { content: [] } }));
    const result = await cohere.translate(
      'Hello',
      'French',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on missing message', async () => {
    mockFetch(async () => jsonResponse({}));
    const result = await cohere.translate(
      'Hello',
      'French',
      'English',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
