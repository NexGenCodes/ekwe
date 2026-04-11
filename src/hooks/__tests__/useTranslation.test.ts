import { renderHook, act } from '@testing-library/react-native';

import { EkweError } from '@/constants/errors';
import { useTranslation } from '@/hooks/useTranslation';
import { TranslationService } from '@/services/Translation';
import { useAudioStore, useHistoryStore, useSettingsStore } from '@/store';
import { ok, err } from '@/types/Result';

jest.mock('src/services/Translation');

describe('useTranslation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAudioStore.setState({
      setError: jest.fn(),
    });
    useHistoryStore.setState({
      entries: [
        {
          id: 'test-entry',
          transcript: 'Hello',
          translation: null,
          sourceApp: null,
          timestamp: 1000,
          duration: 1,
          sourceLang: 'en',
          targetLang: 'es',
        },
      ],
      addEntry: jest.fn(),
      deleteEntry: jest.fn(),
    });
    useSettingsStore.setState({
      selectedLanguages: ['es'],
    });
  });

  it('translate sets isTranslating during call', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let resolvePromise: (value: any) => void = () => {};
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    (TranslationService.translate as jest.Mock).mockReturnValue(promise);

    const { result } = renderHook(() => useTranslation());

    let translateResult: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    act(() => {
      translateResult = result.current.translate('Hello', 'en', 'es');
    });

    expect(result.current.isTranslating).toBe(true);

    await act(async () => {
      resolvePromise(
        ok({ translation: 'Hola', sourceLang: 'en', targetLang: 'es' }),
      );
      await translateResult;
    });

    expect(result.current.isTranslating).toBe(false);
  });

  it('translate on success sets translation state', async () => {
    (TranslationService.translate as jest.Mock).mockResolvedValue(
      ok({
        translation: 'Hola',
        sourceLang: 'en',
        targetLang: 'es',
      }),
    );

    const { result } = renderHook(() => useTranslation());

    await act(async () => {
      await result.current.translate('Hello', 'en', 'es');
    });

    expect(result.current.translation).toBe('Hola');
  });

  it('translate on success updates history entry with translation', async () => {
    const deleteEntry = jest.fn();
    const addEntry = jest.fn();
    useHistoryStore.setState({ deleteEntry, addEntry });
    (TranslationService.translate as jest.Mock).mockResolvedValue(
      ok({
        translation: 'Hola',
        sourceLang: 'en',
        targetLang: 'es',
      }),
    );

    const { result } = renderHook(() => useTranslation());

    await act(async () => {
      await result.current.translate('Hello', 'en', 'es', 'test-entry');
    });

    expect(deleteEntry).toHaveBeenCalledWith('test-entry');
    expect(addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-entry',
        translation: 'Hola',
        targetLang: 'es',
      }),
    );
  });

  it('translate skips history update when no historyEntryId', async () => {
    const deleteEntry = jest.fn();
    useHistoryStore.setState({ deleteEntry });
    (TranslationService.translate as jest.Mock).mockResolvedValue(
      ok({
        translation: 'Hola',
        sourceLang: 'en',
        targetLang: 'es',
      }),
    );

    const { result } = renderHook(() => useTranslation());

    await act(async () => {
      await result.current.translate('Hello', 'en', 'es');
    });

    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it('translate on error calls setError', async () => {
    const setError = jest.fn();
    useAudioStore.setState({ setError });
    (TranslationService.translate as jest.Mock).mockResolvedValue(
      err(EkweError.TRANSLATION_FAIL),
    );

    const { result } = renderHook(() => useTranslation());

    await act(async () => {
      const res = await result.current.translate('Hello', 'en', 'es');
      expect(res.ok).toBe(false);
    });

    expect(setError).toHaveBeenCalledWith(EkweError.TRANSLATION_FAIL);
  });
});
