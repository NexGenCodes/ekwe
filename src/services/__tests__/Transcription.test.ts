import * as FileSystem from 'expo-file-system';
import { EkweError } from 'src/constants/errors';
import { ProcessedAudio } from 'src/services/AudioProcessor';

// Note: TranscriptionService is required inside each test to pick up mocked env vars/modules
// We use require inside tests because TranscriptionService is a singleton exported as a constant.

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn().mockResolvedValue({
    exists: true,
    size: 1024 * 100, // 100KB default
  }),
}));

jest.mock('franc-min', () => ({
  franc: jest.fn().mockReturnValue('eng'),
}));

// Mock FormData for Jest environment
/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof FormData === 'undefined') {
  global.FormData = class {
    append = jest.fn();
  } as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const mockAudio: ProcessedAudio = {
  uri: 'file://mock/recording.m4a',
  durationMs: 5000,
  trimStartMs: 500,
  trimEndMs: 4500,
  hasSpeech: true,
  averageAmplitude: 0.5,
  meteringData: [],
};

describe('TranscriptionService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.EXPO_PUBLIC_WORKER_URL = 'https://mock-worker.dev';
    global.fetch = jest.fn() as jest.Mock;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.skip('returns err(NETWORK_LOST) when WORKER_URL is empty', async () => {
    process.env.EXPO_PUBLIC_WORKER_URL = '';
    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it.skip('returns err(SHARE_COPY_FAIL) when file does not exist', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: false,
    });
    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.SHARE_COPY_FAIL);
    }
  });

  it.skip('returns err(BAD_FORMAT) when file exceeds 25MB', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({
      exists: true,
      size: 50 * 1024 * 1024, // 50MB
    });
    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');

    // If it fails with NETWORK_LOST, it means it skipped size check and hit worker check or threw
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.BAD_FORMAT);
    }
  });

  it('calls fetch with correct FormData fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ text: 'Hello' }),
    });

    const { TranscriptionService } = require('src/services/Transcription');
    await TranscriptionService.transcribe(mockAudio, 'en');

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toBe('https://mock-worker.dev/transcribe');
    expect(fetchCall[1].method).toBe('POST');
    expect(fetchCall[1].body).toBeInstanceOf(FormData);
  });

  it('returns err(NETWORK_LOST) when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network fail'),
    );
    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it('returns err on non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'EKWE_EMPTY_TRANSCRIPT' }),
    });
    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.EMPTY_TRANSCRIPT);
    }
  });

  it('returns ok with processed transcript', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        text: 'Hello world',
        words: [{ word: 'Hello', start: 0, end: 0.5 }],
        language: 'en',
      }),
    });

    const { TranscriptionService } = require('src/services/Transcription');
    const result = await TranscriptionService.transcribe(mockAudio, 'en');
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('Transcription failed with error:', result.error);
    }
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transcript).toBe('Hello world');
      expect(result.value.detectedLang).toBe('en');
    }
  });

  it('strips filler words for English source', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        text: 'Um, hello, like, world',
        words: [],
        language: 'en',
      }),
    });

    const { TranscriptionService } = require('src/services/Transcription');
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
    it('returns en for English text', () => {
      const { franc } = require('franc-min');
      franc.mockReturnValueOnce('eng');
      const { TranscriptionService } = require('src/services/Transcription');
      const lang = TranscriptionService.detectLanguage('English text here');
      expect(lang).toBe('en');
    });

    it('returns und when franc throws', () => {
      const { franc } = require('franc-min');
      franc.mockImplementationOnce(() => {
        throw new Error();
      });
      const { TranscriptionService } = require('src/services/Transcription');
      const lang = TranscriptionService.detectLanguage('...');
      expect(lang).toBe('und');
    });
  });

  describe('isHallucination', () => {
    it('returns true when wps > 6', () => {
      const { TranscriptionService } = require('src/services/Transcription');
      const result = TranscriptionService.isHallucination(
        'one two three four five six seven eight nine ten',
        1000,
      );
      expect(result).toBe(true);
    });

    it('returns true for known patterns', () => {
      const { TranscriptionService } = require('src/services/Transcription');
      const result = TranscriptionService.isHallucination(
        'Thank you for watching',
        5000,
      );
      expect(result).toBe(true);
    });

    it('returns false for normal speech', () => {
      const { TranscriptionService } = require('src/services/Transcription');
      const result = TranscriptionService.isHallucination(
        'This is a normal sentence spoken here.',
        5000,
      );
      expect(result).toBe(false);
    });

    it('returns false for short audio with few words', () => {
      const { TranscriptionService } = require('src/services/Transcription');
      const result = TranscriptionService.isHallucination('Hello.', 1000);
      expect(result).toBe(false);
    });
  });

  it('offsets word timestamps by trimStartMs', async () => {
    const audioWithTrim: ProcessedAudio = { ...mockAudio, trimStartMs: 1000 };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        text: 'Hello',
        words: [{ word: 'Hello', start: 0, end: 1 }],
      }),
    });

    const { TranscriptionService } = require('src/services/Transcription');
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
