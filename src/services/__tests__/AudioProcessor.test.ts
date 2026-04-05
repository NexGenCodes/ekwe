import { EkweError } from 'src/constants/errors';
import { AudioProcessor } from 'src/services/AudioProcessor';

describe('AudioProcessor', () => {
  describe('processRecording', () => {
    it('detects silence if below threshold', async () => {
      const metering = new Array(20).fill(-60); // All quiet
      const result = await AudioProcessor.processRecording(
        'file.m4a',
        2000,
        metering,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.NO_SPEECH);
    });

    it('accepts audio crossing threshold', async () => {
      const metering = [...new Array(10).fill(-60), ...new Array(10).fill(-20)]; // Quiet then loud
      const result = await AudioProcessor.processRecording(
        'file.m4a',
        2000,
        metering,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.uri).toBe('file.m4a');
    });

    it('rejects if duration is < 500ms even if loud', async () => {
      const metering = new Array(5).fill(-10);
      const result = await AudioProcessor.processRecording(
        'file.m4a',
        400,
        metering,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.TOO_SHORT);
    });
  });

  describe('analyseMetering', () => {
    it('returns AUDIO_EMPTY if tracking data is empty', () => {
      const result = AudioProcessor.analyseMetering([], 100);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.AUDIO_EMPTY);
    });

    it('returns NO_SPEECH if below threshold', () => {
      const result = AudioProcessor.analyseMetering(
        new Array(10).fill(-60),
        100,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.NO_SPEECH);
    });

    it('calculates trim points correctly', () => {
      // 0.1s steps. Speech from index 2 to 4 (0.2s to 0.4s)
      const metering = [-60, -60, -20, -10, -20, -60, -60];
      const result = AudioProcessor.analyseMetering(metering, 100);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.trimStartMs).toBe(100); // 200 - 100 padding
        expect(result.value.trimEndMs).toBe(600); // 500 + 100 padding
        expect(result.value.isLowQuality).toBe(false);
      }
    });
  });

  describe('validateSharedFile', () => {
    const FileSystem = require('expo-file-system');

    it('returns error if uri is empty', async () => {
      const result = await AudioProcessor.validateSharedFile('');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.SHARE_COPY_FAIL);
    });

    it('returns ok for valid file', async () => {
      const { File: MockFile } = require('expo-file-system');
      (MockFile as jest.Mock).mockImplementationOnce(() => ({
        exists: true,
        size: 5 * 1024 * 1024,
      }));
      const result = await AudioProcessor.validateSharedFile('valid.mp3');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.uri).toBe('valid.mp3');
    });

    it('returns SHARE_COPY_FAIL if file does not exist', async () => {
      const { File: MockFile } = require('expo-file-system');
      (MockFile as jest.Mock).mockImplementationOnce(() => ({
        exists: false,
      }));
      const result = await AudioProcessor.validateSharedFile('missing.mp3');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.SHARE_COPY_FAIL);
    });

    it('returns FILE_TOO_LARGE if size > 25MB', async () => {
      const { File: MockFile } = require('expo-file-system');
      (MockFile as jest.Mock).mockImplementationOnce(() => ({
        exists: true,
        size: 30 * 1024 * 1024,
      }));
      const result = await AudioProcessor.validateSharedFile('huge.mp3');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.FILE_TOO_LARGE);
    });
  });
});
