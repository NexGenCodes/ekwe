import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import { TranscriptionService } from '@/services/Transcription';
import { fetchWithRetry } from '@/utils/networkUtils';

// Set environment variable at top-level
process.env.EXPO_PUBLIC_WORKER_URL = 'https://mock-worker.dev';

jest.mock('src/utils/networkUtils', () => ({
  fetchWithRetry: jest.fn(),
}));

jest.mock('src/utils/authHeaders', () => ({
  getAuthHeaders: jest.fn(() =>
    Promise.resolve({ Authorization: 'Bearer mock-token' }),
  ),
}));

jest.mock('src/utils/detectLanguage', () => ({
  detectLanguage: jest.fn(() => 'und'),
}));

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(() =>
    Promise.resolve({
      exists: true,
      size: 1024 * 100, // 100KB default
    }),
  ),
  File: jest.fn(() => ({
    exists: true,
    size: 1024 * 100,
  })),
}));

// Mock AbortController and FormData for Jest environment
if (typeof AbortController === 'undefined') {
  global.AbortController = class {
    signal = {
      aborted: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    abort = jest.fn();
  } as unknown as typeof AbortController;
}

if (typeof FormData === 'undefined') {
  global.FormData = class {
    append = jest.fn();
    delete = jest.fn();
    get = jest.fn();
    getAll = jest.fn();
    has = jest.fn();
    set = jest.fn();
    forEach = jest.fn();
  } as unknown as typeof FormData;
} else if (
  !(global.FormData.prototype as unknown as { append: unknown }).append
) {
  // If FormData exists but is a mock/incomplete, ensure append is there
  (global.FormData.prototype as unknown as { append: unknown }).append =
    jest.fn();
}

const mockAudio: ProcessedAudio = {
  uri: 'file://mock/recording.m4a',
  durationMs: 5000,
  trimStartMs: 500,
  trimEndMs: 4500,
  hasSpeech: true,
  averageDb: 0.5,
  meteringData: [],
};

describe('TranscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_WORKER_URL = 'https://mock-worker.dev';
  });

  it.skip('returns err(NETWORK_LOST) when WORKER_URL is empty', async () => {
    process.env.EXPO_PUBLIC_WORKER_URL = '';
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
    process.env.EXPO_PUBLIC_WORKER_URL = 'https://mock-worker.dev';
  });

  it.skip('returns err(SHARE_COPY_FAIL) when file does not exist', async () => {
    const { File: MockFile } = require('expo-file-system');
    (MockFile as jest.Mock).mockImplementationOnce(() => ({
      exists: false,
    }));
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.SHARE_COPY_FAIL);
    }
  });

  it.skip('returns err(BAD_FORMAT) when file exceeds 25MB', async () => {
    const { File: MockFile } = require('expo-file-system');
    (MockFile as jest.Mock).mockImplementationOnce(() => ({
      exists: true,
      size: 50 * 1024 * 1024, // 50MB
    }));
    const result = await TranscriptionService.transcribe(mockAudio, 'en');

    // If it fails with NETWORK_LOST, it means it skipped size check and hit worker check or threw
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.BAD_FORMAT);
    }
  });

  it('calls fetch with correct FormData fields', async () => {
    (
      fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>
    ).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ text: 'Hello' }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);

    await TranscriptionService.transcribe(mockAudio, 'en');

    const call = (fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>)
      .mock.calls[0];
    expect(call).toBeDefined();
    expect(call![0]).toBe('https://mock-worker.dev/transcribe');
    expect(call![1]!.method).toBe('POST');
    expect(call![1]!.body).toBeInstanceOf(FormData);
  });

  it('returns err(NETWORK_LOST) when fetch throws', async () => {
    (fetchWithRetry as jest.Mock).mockRejectedValueOnce(
      new Error('Network fail'),
    );
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it('returns err on non-ok response', async () => {
    (
      fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>
    ).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'EKWE_EMPTY_TRANSCRIPT' }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.EMPTY_TRANSCRIPT);
    }
  });

  it('returns ok with processed transcript', async () => {
    (
      fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>
    ).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: 'Hello world',
          words: [{ word: 'Hello', start: 0, end: 0.5 }],
          language: 'en',
        }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);

    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('Transcription failed with error:', result.error);
    }
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transcript).toBe('Hello world');
      expect(result.value.detectedLang).toBe('und');
    }
  });

  it('strips filler words for English source', async () => {
    (
      fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>
    ).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: 'Um, hello, like, world',
          words: [],
          language: 'en',
        }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);

    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('Transcription failed with error:', result.error);
    }
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transcript).toBe('hello, world');
      expect(result.value.fillerWordsRemoved).toBeGreaterThan(0);
    }
  });

  describe('detectLanguage', () => {
    it('returns und as it relies on backend detection now', () => {
      const lang = TranscriptionService.detectLanguage('English text here');
      expect(lang).toBe('und');
    });
  });

  describe('isHallucination', () => {
    it('returns true when wps > 6', () => {
      const result = TranscriptionService.isHallucination(
        'one two three four five six seven eight nine ten',
        1000,
      );
      expect(result).toBe(true);
    });

    it('returns true for known patterns', () => {
      const result = TranscriptionService.isHallucination(
        'Thank you for watching',
        5000,
      );
      expect(result).toBe(true);
    });

    it('returns false for normal speech', () => {
      const result = TranscriptionService.isHallucination(
        'This is a normal sentence spoken here.',
        5000,
      );
      expect(result).toBe(false);
    });

    it('returns false for short audio with few words', () => {
      const result = TranscriptionService.isHallucination('Hello.', 1000);
      expect(result).toBe(false);
    });
  });

  it('offsets word timestamps by trimStartMs', async () => {
    const audioWithTrim: ProcessedAudio = { ...mockAudio, trimStartMs: 1000 };
    (
      fetchWithRetry as jest.MockedFunction<typeof fetchWithRetry>
    ).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          text: 'Hello',
          words: [{ word: 'Hello', start: 0, end: 1 }],
        }),
    } as Awaited<ReturnType<typeof fetchWithRetry>>);

    const result = await TranscriptionService.transcribe(audioWithTrim, 'en');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('Transcription failed with error:', result.error);
    }
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.wordTimestamps[0].start).toBe(1); // 0 + 1 (offset)
      expect(result.value.wordTimestamps[0].end).toBe(2); // 1 + 1 (offset)
    }
  });
});
