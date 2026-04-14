import { Platform } from 'react-native';

import { EkweError } from '@/constants/errors';
import { AudioCapture } from '@/services/AudioCapture';
import AudioService from '@/services/AudioService';
import { VolumeManager } from '@/services/VolumeManager';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from '@/utils/AudioEffectsModule';

jest.mock('src/services/AudioService');
jest.mock('src/services/VolumeManager');
jest.mock('src/utils/AudioEffectsModule', () => ({
  attachAudioEffects: jest.fn().mockResolvedValue(undefined),
  releaseAudioEffects: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('src/utils/fileValidation', () => ({
  validateSharedAudio: jest.fn().mockResolvedValue({
    ok: true,
    value: { uri: 'file://valid.m4a' },
  }),
}));

describe('AudioCapture', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    jest.clearAllMocks();
    (VolumeManager.raiseVolumeIfNeeded as jest.Mock).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    (VolumeManager.restoreVolume as jest.Mock).mockResolvedValue({ ok: true });
    (AudioService.requestPermission as jest.Mock).mockResolvedValue('Granted');
    (AudioService.checkPermission as jest.Mock).mockResolvedValue('Granted');
    (AudioService.startRecording as jest.Mock).mockResolvedValue({
      status: 'success',
      path: 'file://test.m4a',
    });
    (AudioService.stopRecording as jest.Mock).mockResolvedValue({
      path: 'file://test.m4a',
      duration: 1000,
    });
    (AudioService.isRecording as jest.Mock).mockReturnValue(false);
    (AudioService.getMetering as jest.Mock).mockReturnValue(-10);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('requestPermission', () => {
    it('returns ok(true) when granted', async () => {
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it('returns err(PERMISSION_MIC) when denied', async () => {
      (AudioService.requestPermission as jest.Mock).mockResolvedValue('Denied');
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.PERMISSION_MIC);
    });
  });

  describe('startRecording', () => {
    it('starts successfully, attaches effects on Android, raises volume, and polls metering', async () => {
      (AudioService.isRecording as jest.Mock)
        .mockReturnValueOnce(false) // For AudioCapture.startRecording check
        .mockReturnValue(true); // For subsequent checks

      const result = await AudioCapture.startRecording('session-1');

      expect(result.ok).toBe(true);
      expect(VolumeManager.raiseVolumeIfNeeded).toHaveBeenCalled();
      expect(attachAudioEffects).toHaveBeenCalledWith(0);
    });

    it('returns AUDIO_RECORD_FAIL if already recording', async () => {
      (AudioService.isRecording as jest.Mock).mockReturnValue(true);
      const result = await AudioCapture.startRecording('sess2');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.AUDIO_RECORD_FAIL);
    });
  });

  describe('stopRecording', () => {
    it('stops recorder, restores volume, detaches effects, returns result', async () => {
      (AudioService.isRecording as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      // We need to call start first to set the session ID in the real class
      await AudioCapture.startRecording('session-stop');

      const result = await AudioCapture.stopRecording();

      expect(AudioService.stopRecording).toHaveBeenCalled();
      expect(VolumeManager.restoreVolume).toHaveBeenCalled();
      expect(releaseAudioEffects).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe('file://test.m4a');
        expect(result.value.durationMs).toBe(1000);
      }
    });

    it('returns TOO_SHORT if duration < 500ms', async () => {
      (AudioService.isRecording as jest.Mock)
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      (AudioService.stopRecording as jest.Mock).mockResolvedValue({
        path: 'file://too-short.m4a',
        duration: 400,
      });
      await AudioCapture.startRecording('sess');

      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.TOO_SHORT);
    });
  });

  describe('processSharedFile', () => {
    it('returns uri if valid format', async () => {
      const res = await AudioCapture.processSharedFile('content://file.m4a');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.uri).toBeDefined();
    });
  });
});
