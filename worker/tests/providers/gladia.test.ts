import { describe, test, expect } from 'vitest';
import * as gladia from '../../src/providers/gladia';
import { mockEnv, makeAudioBlob, jsonResponse, mockFetch, mockFetchReset, mockSignal } from '../setup';

describe('Gladia provider', () => {
  afterEach(() => { mockFetchReset(); });

  test('returns result on successful full flow', async () => {
    let step = 0;
    mockFetch(async (url) => {
      step++;
      if (url.includes('gladia.io/v2/upload')) {
        return jsonResponse({ audio_url: 'https://mock.audio/url' });
      }
      if (url.includes('gladia.io/v2/pre-recorded')) {
        return jsonResponse({ result_url: 'https://mock.gladia/result' });
      }
      if (url.includes('mock.gladia/result')) {
        return jsonResponse({
          status: 'done',
          result: {
            transcription: { full_transcript: 'Hello world', languages: [{ language: 'en' }] },
          },
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await gladia.transcribe(makeAudioBlob(), 'en', mockEnv(), mockSignal());
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello world');
    expect(result!.provider).toBe('gladia');
  });

  test('returns null on upload error', async () => {
    mockFetch(async (url) => {
      if (url.includes('gladia.io/v2/upload')) return jsonResponse({ error: 'bad key' }, 401);
      return jsonResponse({}, 404);
    });
    const result = await gladia.transcribe(makeAudioBlob(), 'en', mockEnv(), mockSignal());
    expect(result).toBeNull();
  });

  test('returns null on polling timeout', async () => {
    mockFetch(async (url) => {
      if (url.includes('gladia.io/v2/upload')) return jsonResponse({ audio_url: 'https://mock.audio/url' });
      if (url.includes('gladia.io/v2/pre-recorded')) return jsonResponse({ result_url: 'https://mock.gladia/result' });
      if (url.includes('mock.gladia/result')) return jsonResponse({ status: 'running' });
      return jsonResponse({}, 404);
    });

    const result = await gladia.transcribe(makeAudioBlob(), 'en', mockEnv({ GLADIA_KEY_2: '', GLADIA_KEY_3: '', GLADIA_KEY_4: '', GLADIA_KEY_5: '' }), mockSignal());
    expect(result).toBeNull();
  }, 15000);
});
