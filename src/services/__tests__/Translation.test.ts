import { EkweError } from 'src/constants/errors';

// Note: TranslationService is required inside tests to pick up mocked env vars

describe('TranslationService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      EXPO_PUBLIC_WORKER_URL: 'https://mock-worker.dev',
    };
    global.fetch = jest.fn() as jest.Mock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns err(NETWORK_LOST) when WORKER_URL is empty', async () => {
    delete process.env.EXPO_PUBLIC_WORKER_URL;
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
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: 'Hola' }),
    });

    const { TranslationService } = require('src/services/Translation');
    await TranslationService.translate('Hello', 'en', 'es');

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe('https://mock-worker.dev/translate');
    expect(fetchCall[1].method).toBe('POST');
    expect(JSON.parse(fetchCall[1].body)).toEqual({
      text: 'Hello',
      targetLang: 'Spanish',
      sourceLang: 'English',
    });
  });

  it('returns ok with translation string', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: 'Hola' }),
    });

    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.translation).toBe('Hola');
    }
  });

  it('returns err(NETWORK_LOST) when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network fail'),
    );
    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it('returns err on non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'EKWE_TRANSLATION_FAIL' }),
    });
    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });

  it('returns err(TRANSLATION_FAIL) when translation empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ translation: '  ' }),
    });
    const { TranslationService } = require('src/services/Translation');
    const result = await TranslationService.translate('Hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });
});
