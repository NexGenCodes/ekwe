import { describe, test, expect, vi } from 'vitest';
import * as groq from '../../src/providers/groq';
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('Groq provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  describe('transcribe', () => {
    test('returns result on success', async () => {
      mockFetch(async (url) => {
        if (url.includes('groq.com/openai/v1/audio/transcriptions')) {
          return jsonResponse({
            text: 'Hello world',
            duration: 3.0,
            language: 'en',
          });
        }
        return jsonResponse({}, 404);
      });

      const blob = makeAudioBlob();
      const result = await groq.transcribe(blob, 'en', mockEnv(), mockSignal());
      expect(result).not.toBeNull();
      expect(result!.text).toBe('Hello world');
      expect(result!.provider).toBe('groq');
      expect(result!.duration).toBe(3.0);
      expect(result!.language).toBe('en');
    });

    test('returns null on HTTP error', async () => {
      mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
      const result = await groq.transcribe(
        makeAudioBlob(),
        'en',
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test('returns null on hallucination', async () => {
      mockFetch(async () =>
        jsonResponse({ text: 'Thanks for watching', duration: 1.0 }),
      );
      const result = await groq.transcribe(
        makeAudioBlob(),
        'en',
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });

    test('returns null on empty response', async () => {
      mockFetch(async () => jsonResponse({}));
      const result = await groq.transcribe(
        makeAudioBlob(),
        'en',
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });

  describe('translate', () => {
    test('returns translation on success', async () => {
      mockFetch(async (url) => {
        if (url.includes('groq.com/openai/v1/chat/completions')) {
          return jsonResponse({
            choices: [{ message: { content: 'Hola mundo' } }],
          });
        }
        return jsonResponse({}, 404);
      });

      const result = await groq.translate(
        'Hello world',
        'Spanish',
        'English',
        mockEnv(),
        mockSignal(),
      );
      expect(result).not.toBeNull();
      expect(result!.translation).toBe('Hola mundo');
      expect(result!.provider).toBe('groq-llama-3.3-70b');
    });

    test('returns null on HTTP error', async () => {
      mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
      const result = await groq.translate(
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
      const result = await groq.translate(
        'Hello',
        'Spanish',
        'English',
        mockEnv(),
        mockSignal(),
      );
      expect(result).toBeNull();
    });
  });
});
