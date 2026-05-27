import { vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '../src/types';

// ─── Mock Env Factory ──────────────────────────────────────────────

export function mockEnv(overrides: Partial<Env> = {}): Env {
  const kv = {
    _store: new Map<string, string>(),
    get: vi.fn(
      async (key: string) => kv._store.get(key) ?? null,
    ) as Env['EKWE_KV']['get'],
    put: vi.fn(
      async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        kv._store.set(key, value);
        if (opts?.expirationTtl) {
          setTimeout(() => kv._store.delete(key), opts.expirationTtl * 1000);
        }
      },
    ) as Env['EKWE_KV']['put'],
  } as Env['EKWE_KV'];

  const ai = {
    run: vi.fn(async (_model: string, inputs: Record<string, unknown>) => {
      if (_model === '@cf/openai/whisper') {
        const text = Array.isArray(inputs?.audio)
          ? 'mock whisper transcription'
          : '';
        return { text };
      }
      if (_model === '@cf/meta/llama-3-8b-instruct') {
        return { response: 'translated text' };
      }
      return {};
    }) as Env['AI']['run'],
  } as Env['AI'];

  const rateLimiter = {
    limit: vi.fn(async () => ({ success: true })),
  } as Env['RATE_LIMITER'];

  return {
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
    EKWE_KV: kv,
    AI: ai,
    RATE_LIMITER: rateLimiter,
    GROQ_KEY_1: 'mock-groq-key-1-abcde',
    GROQ_KEY_2: 'mock-groq-key-2-abcde',
    DEEPGRAM_KEY_1: 'mock-deepgram-1-abcde',
    DEEPGRAM_KEY_2: 'mock-deepgram-2-abcde',
    GLADIA_KEY_1: 'mock-gladia-key-1-abcde',
    GLADIA_KEY_2: 'mock-gladia-key-2-abcde',
    GLADIA_KEY_3: 'mock-gladia-key-3-abcde',
    GLADIA_KEY_4: 'mock-gladia-key-4-abcde',
    GLADIA_KEY_5: 'mock-gladia-key-5-abcde',
    ASSEMBLYAI_KEY_1: 'mock-assembly-1-abcde',
    ASSEMBLYAI_KEY_2: 'mock-assembly-2-abcde',
    GEMINI_KEY_1: 'mock-gemini-key-1-abcde',
    GEMINI_KEY_2: 'mock-gemini-key-2-abcde',
    GEMINI_KEY_3: 'mock-gemini-key-3-abcde',
    COHERE_KEY_1: 'mock-cohere-key-1-abcde',
    COHERE_KEY_2: 'mock-cohere-key-2-abcde',
    COHERE_KEY_3: 'mock-cohere-key-3-abcde',
    MISTRAL_KEY_1: 'mock-mistral-key-1-abcde',
    MISTRAL_KEY_2: 'mock-mistral-key-2-abcde',
    MISTRAL_KEY_3: 'mock-mistral-key-3-abcde',
    MISTRAL_KEY_4: 'mock-mistral-key-4-abcde',
    MISTRAL_KEY_5: 'mock-mistral-key-5-abcde',
    OPENROUTER_KEY: 'mock-openrouter-key',
    AZURE_KEY_1: 'mock-azure-key-1-abcde',
    AZURE_REGION: 'eastus',
    WIT_KEY_EN: 'mock-wit-en-key-10',
    WIT_KEY_FR: 'mock-wit-fr-key-10',
    WIT_KEY_ES: 'mock-wit-es-key-10',
    ...overrides,
  } as Env;
}

// ─── Mock Blob / Audio Helpers ─────────────────────────────────────

export function makeAudioBlob(): Blob {
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const durationSec = 0.1;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (v: DataView, o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

// ─── Mock Fetch Infrastructure ─────────────────────────────────────

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

let currentHandler: FetchHandler | null = null;

export function mockFetch(handler: FetchHandler): void {
  currentHandler = handler;
}

export function mockFetchURL(urlPattern: string, response: Response): void {
  const originalFetch = globalThis.fetch;
  mockFetch(async (url, init) => {
    if (String(url).includes(urlPattern)) return response;
    return originalFetch(url, init);
  });
}

export function mockFetchReset(): void {
  currentHandler = null;
}

// Install fetch interceptor
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (currentHandler) return currentHandler(String(url), init);
  return originalFetch(url, init);
};

// ─── JSON Response Helper ──────────────────────────────────────────

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Signal Helper ─────────────────────────────────────────────────

export function mockSignal(): AbortSignal {
  return new AbortController().signal;
}

// ─── Auto-cleanup after each test ──────────────────────────────────

afterEach(() => {
  currentHandler = null;
});
