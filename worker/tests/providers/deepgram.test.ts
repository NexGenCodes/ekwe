import { describe, test, expect } from 'vitest';
import * as deepgram from '../../src/providers/deepgram';
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockFetch,
  mockFetchReset,
  mockSignal,
} from '../setup';

describe('Deepgram provider', () => {
  afterEach(() => {
    mockFetchReset();
  });

  test('returns result on success', async () => {
    mockFetch(async () =>
      jsonResponse({
        results: {
          channels: [
            {
              alternatives: [{ transcript: 'Hello world', confidence: 0.99 }],
              detected_language: 'en',
            },
          ],
        },
        metadata: { duration: 3.5 },
      }),
    );

    const result = await deepgram.transcribe(
      makeAudioBlob(),
      'en',
      mockEnv(),
      mockSignal(),
    );
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello world');
    expect(result!.provider).toBe('deepgram');
    expect(result!.language).toBe('en');
    expect(result!.duration).toBe(3.5);
  });

  test('returns null on empty transcript', async () => {
    mockFetch(async () =>
      jsonResponse({
        results: { channels: [{ alternatives: [{ transcript: '' }] }] },
      }),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      'en',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on missing channels', async () => {
    mockFetch(async () => jsonResponse({ results: {} }));
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      'en',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on hallucination', async () => {
    mockFetch(async () =>
      jsonResponse({
        results: {
          channels: [
            {
              alternatives: [{ transcript: 'Thanks for watching' }],
              detected_language: 'en',
            },
          ],
        },
        metadata: { duration: 1.0 },
      }),
    );
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      'en',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });

  test('returns null on HTTP 403', async () => {
    mockFetch(async () => jsonResponse({ error: 'credit exhausted' }, 403));
    const result = await deepgram.transcribe(
      makeAudioBlob(),
      'en',
      mockEnv(),
      mockSignal(),
    );
    expect(result).toBeNull();
  });
});
