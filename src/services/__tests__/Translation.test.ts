import { EkweError } from '@/constants/errors';

// Note: TranslationService is required inside tests to pick up mocked env vars

jest.mock('src/utils/networkUtils', () => ({
  fetchWithRetry: jest.fn(),
}));

jest.mock('src/utils/authHeaders', () => ({
  getAuthHeaders: jest.fn(() =>
    Promise.resolve({ Authorization: 'Bearer mock-token' }),
  ),
}));

describe('TranslationService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_WORKER_URL = 'https://mock-worker.dev';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_WORKER_URL = originalEnv.EXPO_PUBLIC_WORKER_URL;
  });

  it('returns err(NETWORK_LOST) when WORKER_URL is empty', async () => {
    process.env.EXPO_PUBLIC_WORKER_URL = '';
    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it('returns err(EMPTY_TRANSCRIPT) for empty text', async () => {
    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('  ', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.EMPTY_TRANSCRIPT);
    }
  });

  it('calls fetch with correct JSON body', async () => {
    const { fetchWithRetry } = require('src/utils/networkUtils');
    const { TranslationService } = require('src/services/Translation');
    (fetchWithRetry as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: 'Hola' }),
    });

    await TranslationService.translate('Hello', 'en', 'es');

    const fetchCall = (fetchWithRetry as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe('https://mock-worker.dev/translate');
    expect(fetchCall[1].method).toBe('POST');
    expect(JSON.parse(fetchCall[1].body)).toEqual({
      text: 'Hello',
      targetLang: 'Spanish',
      sourceLang: 'English',
    });
  });

  it('returns ok with translation string', async () => {
    const { fetchWithRetry } = require('src/utils/networkUtils');
    const { TranslationService } = require('src/services/Translation');
    (fetchWithRetry as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: 'Hola' }),
    });

    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.translation).toBe('Hola');
    }
  });

  it('returns err(NETWORK_LOST) when fetch throws', async () => {
    const { fetchWithRetry } = require('src/utils/networkUtils');
    const { TranslationService } = require('src/services/Translation');
    (fetchWithRetry as jest.Mock).mockRejectedValueOnce(
      new Error('Network fail'),
    );
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it('returns err on non-ok response', async () => {
    const { fetchWithRetry } = require('src/utils/networkUtils');
    const { TranslationService } = require('src/services/Translation');
    (fetchWithRetry as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'EKWE_TRANSLATION_FAIL' }),
    });
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });

  it('returns err(TRANSLATION_FAIL) when translation empty', async () => {
    const { fetchWithRetry } = require('src/utils/networkUtils');
    const { TranslationService } = require('src/services/Translation');
    (fetchWithRetry as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: '  ' }),
    });
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });
});
