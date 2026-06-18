import { describe, test, expect, vi } from 'vitest';
import { handleTranscribe } from '../src/routes/transcribe';
import {
  mockEnv,
  makeAudioBlob,
  jsonResponse,
  mockFetch,
  mockFetchReset,
} from './setup';

function makeRequest(lang?: string): Request {
  const blob = makeAudioBlob();
  const form = new FormData();
  form.append('file', blob, 'test.wav');
  if (lang) form.append('lang', lang);
  return new Request('http://test/transcribe', {
    method: 'POST',
    body: form,
  });
}

describe('handleTranscribe pipeline', () => {
  afterEach(() => {
    mockFetchReset();
  });

  test('FREE pipeline returns result from first successful provider', async () => {
    const calls: string[] = [];
    mockFetch(async (url, _init) => {
      calls.push(url);
      if (url.includes('api.wit.ai'))
        return jsonResponse({ text: 'wit result' });
      return jsonResponse({}, 404);
    });

    const res = await handleTranscribe(
      makeRequest('en'),
      mockEnv(),
      'FREE',
      new AbortController().signal,
    );
    const body = (await res.json()) as { text?: string };
    expect(body.text).toBe('wit result');
  });

  test('skipOnAuto skips witai when lang is auto', async () => {
    let witCalled = false;
    mockFetch(async (url) => {
      if (url.includes('api.wit.ai')) {
        witCalled = true;
        return jsonResponse({ text: 'wit result' });
      }
      if (url.includes('api.gladia.io/v2/upload'))
        return jsonResponse({ audio_url: 'https://mock.audio/url' });
      if (url.includes('api.gladia.io/v2/pre-recorded'))
        return jsonResponse({ result_url: 'https://mock.gladia/result' });
      if (url.includes('mock.gladia/result'))
        return jsonResponse({
          status: 'done',
          result: { transcription: { full_transcript: 'gladia result' } },
        });
      return jsonResponse({}, 404);
    });

    const res = await handleTranscribe(
      makeRequest('auto'),
      mockEnv({
        GLADIA_KEY_2: '',
        GLADIA_KEY_3: '',
        GLADIA_KEY_4: '',
        GLADIA_KEY_5: '',
      } as any),
      'PREMIUM',
      new AbortController().signal,
    );
    const body = (await res.json()) as { text?: string };
    expect(witCalled).toBe(false);
    expect(body.text).toBe('gladia result');
  }, 15000);

  test('returns 400 when file is missing', async () => {
    const form = new FormData();
    form.append('lang', 'en');
    const req = new Request('http://test/transcribe', {
      method: 'POST',
      body: form,
    });
    const res = await handleTranscribe(
      req,
      mockEnv(),
      'FREE',
      new AbortController().signal,
    );
    expect(res.status).toBe(400);
  });

  test('supportedLanguages skips cohere for unsupported language', async () => {
    let cohereCalled = false;
    mockFetch(async (url) => {
      if (url.includes('api.cohere.com/v2/audio/transcriptions')) {
        cohereCalled = true;
        return jsonResponse({ text: 'cohere result' });
      }
      return jsonResponse({}, 404);
    });

    const env = mockEnv({
      AI: { run: async () => { return {}; } },
    } as any);

    const res = await handleTranscribe(
      makeRequest('ig'), // not in cohere's supportedLanguages
      env,
      'FREE',
      new AbortController().signal,
    );
    expect(cohereCalled).toBe(false);
    expect(res.status).toBe(503);
  });

  test('supportedLanguages does not skip cohere for supported language', async () => {
    let cohereCalled = false;
    mockFetch(async (url) => {
      if (url.includes('api.cohere.com/v2/audio/transcriptions')) {
        cohereCalled = true;
        return jsonResponse({ text: 'cohere result' });
      }
      return jsonResponse({}, 404);
    });

    const env = mockEnv({
      WIT_KEY_ES: '', // witai skipped - no key for Spanish
      AI: { run: async () => { return {}; } },
    } as any);

    const res = await handleTranscribe(
      makeRequest('es'), // in cohere's supportedLanguages
      env,
      'FREE',
      new AbortController().signal,
    );
    expect(cohereCalled).toBe(true);
    const body = (await res.json()) as { text?: string };
    expect(body.text).toBe('cohere result');
  });

  test('returns 503 when all providers fail', async () => {
    mockFetch(async () => jsonResponse({ error: 'fail' }, 500));
    const env = mockEnv({
      WIT_KEY_EN: '', // witai skipped - no key
      AI: { run: vi.fn().mockRejectedValue(new Error('fail')) },
    } as any);

    const res = await handleTranscribe(
      makeRequest('en'),
      env,
      'FREE',
      new AbortController().signal,
    );
    expect(res.status).toBe(503);
  });

  test('PREMIUM pipeline uses different provider order', async () => {
    const providerOrder: string[] = [];
    mockFetch(async (url) => {
      if (url.includes('api.deepgram.com')) {
        providerOrder.push('deepgram');
        return jsonResponse({
          text: 'deepgram result',
          metadata: { duration: 1.0 },
          results: {
            channels: [
              {
                alternatives: [{ transcript: 'deepgram result' }],
                detected_language: 'en',
              },
            ],
          },
        });
      }
      if (url.includes('api.gladia.io/v2/upload')) {
        providerOrder.push('gladia');
        return jsonResponse({ audio_url: 'mock' });
      }
      if (url.includes('api.gladia.io/v2/pre-recorded'))
        return jsonResponse({ result_url: 'mock' });
      return jsonResponse({}, 404);
    });

    const res = await handleTranscribe(
      makeRequest('en'),
      mockEnv(),
      'PREMIUM',
      new AbortController().signal,
    );
    const body = (await res.json()) as { text?: string };
    expect(body.text).toContain('deepgram');
    expect(providerOrder[0]).toBe('deepgram');
  });
});
