import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Platform } from 'react-native';
import { EkweError } from 'src/constants/errors';
import { AudioCapture, RecorderHandle } from 'src/services/AudioCapture';
import { VolumeManager } from 'src/services/VolumeManager';
import {
  attachAudioEffects,
  releaseAudioEffects,
} from 'src/utils/AudioEffectsModule';

jest.mock('src/services/VolumeManager');
jest.mock('src/utils/AudioEffectsModule', () => ({
  attachAudioEffects: jest.fn().mockResolvedValue(undefined),
  releaseAudioEffects: jest.fn().mockResolvedValue(undefined),
}));

interface MockRecorderHandle extends RecorderHandle {
  record: jest.Mock;
  stop: jest.Mock;
  prepareToRecordAsync: jest.Mock;
  getStatus: jest.Mock;
}

describe('AudioCapture', () => {
  let mockRecorder: MockRecorderHandle;

  beforeEach(() => {
    Platform.OS = 'android';
    jest.clearAllMocks();
    (VolumeManager.raiseVolumeIfNeeded as jest.Mock).mockResolvedValue(
      undefined,
    );
    (VolumeManager.restoreVolume as jest.Mock).mockResolvedValue(undefined);
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
    (setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    AudioCapture._resetForTesting();

    mockRecorder = {
      record: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
      prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockReturnValue({
        isRecording: true,
        durationMillis: 1000,
        metering: -10,
        url: 'file://test.m4a',
      }),
      uri: 'file://test.m4a',
    };
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
      (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: false,
      });
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.PERMISSION_MIC);
    });

    it('returns err(PERMISSION_MIC) on throw', async () => {
      (requestRecordingPermissionsAsync as jest.Mock).mockRejectedValue(
        new Error('crash'),
      );
      const result = await AudioCapture.requestPermission();
      expect(result.ok).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('returns ok(granted) from getPermissionsAsync', async () => {
      const result = await AudioCapture.checkPermission();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    it('returns err(PERMISSION_MIC) on throw', async () => {
      (getRecordingPermissionsAsync as jest.Mock).mockRejectedValue(
        new Error('crash'),
      );
      const result = await AudioCapture.checkPermission();
      expect(result.ok).toBe(false);
    });
  });

  describe('startRecording', () => {
    it('starts successfully, attaches effects on Android, raises volume, and polls metering', async () => {
      const onMetering = jest.fn();

      const result = await AudioCapture.startRecording('session-1', onMetering);

      expect(result.ok).toBe(true);
      expect(VolumeManager.raiseVolumeIfNeeded).toHaveBeenCalled();
      expect(attachAudioEffects).toHaveBeenCalledWith(0);
      expect(AudioCapture.isRecording()).toBe(true);
      // Wait for at least one interval tick
      await new Promise((r) => setTimeout(r, 150));
      expect(onMetering).toHaveBeenCalled();
    });

    it('does not attach effects on iOS', async () => {
      Platform.OS = 'ios';
      // Mock startRecording to just set our own mock and return ok to bypass dynamic import logic for basic test
      AudioCapture._setRecorderForTesting(mockRecorder, 'session-ios');
      await AudioCapture.startRecording('session-ios', jest.fn());
      // Actually we should test the real method
      AudioCapture._resetForTesting();
      await AudioCapture.startRecording('session-ios', jest.fn());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(attachAudioEffects).not.toHaveBeenCalled();
    });

    it('returns AUDIO_RECORD_FAIL if already recording', async () => {
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess');
      const result = await AudioCapture.startRecording('sess2', jest.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.AUDIO_RECORD_FAIL);
    });

    it('returns PERMISSION_MIC if checkPermission is false', async () => {
      (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue({
        granted: false,
      });
      const result = await AudioCapture.startRecording('sess', jest.fn());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.PERMISSION_MIC);
    });
  });

  describe('stopRecording', () => {
    it('stops recorder, restores volume, detaches effects, returns result', async () => {
      AudioCapture._setRecorderForTesting(mockRecorder, 'session-stop');
      const result = await AudioCapture.stopRecording();

      expect(mockRecorder.stop).toHaveBeenCalled();
      expect(VolumeManager.restoreVolume).toHaveBeenCalled();
      expect(releaseAudioEffects).toHaveBeenCalled();
      expect(AudioCapture.isRecording()).toBe(false);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.uri).toBe('file://test.m4a');
        expect(result.value.durationMs).toBe(1000);
      }
    });

    it('returns AUDIO_RECORD_FAIL if not recording', async () => {
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.AUDIO_RECORD_FAIL);
    });

    it('returns AUDIO_EMPTY if uri is null', async () => {
      mockRecorder.uri = null;
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess');
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.AUDIO_EMPTY);
    });

    it('returns TOO_SHORT if duration < 500ms', async () => {
      mockRecorder.getStatus.mockReturnValue({ durationMillis: 400 });
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess');
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.TOO_SHORT);
    });

    it('returns INTERRUPTED if stop throws', async () => {
      mockRecorder.stop.mockRejectedValue(new Error('crash'));
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess');
      const result = await AudioCapture.stopRecording();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(EkweError.INTERRUPTED);
    });
  });

  describe('cancelRecording', () => {
    it('stops gracefully without returning a result, restores vol + detach effects', async () => {
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess-cancel');
      const result = await AudioCapture.cancelRecording();

      expect(result.ok).toBe(true);
      expect(mockRecorder.stop).toHaveBeenCalled();
      expect(VolumeManager.restoreVolume).toHaveBeenCalled();
      expect(releaseAudioEffects).toHaveBeenCalled();
      expect(AudioCapture.isRecording()).toBe(false);
    });

    it('swallows stop errors', async () => {
      mockRecorder.stop.mockRejectedValue(new Error('ignore'));
      AudioCapture._setRecorderForTesting(mockRecorder, 'sess-cancel');
      const result = await AudioCapture.cancelRecording();
      expect(result.ok).toBe(true);
      expect(AudioCapture.isRecording()).toBe(false);
    });
  });

  describe('processSharedFile', () => {
    it('returns uri if valid format', async () => {
      const res = await AudioCapture.processSharedFile('content://file.mp3');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.uri).toBe('content://file.mp3');
    });

    it('returns BAD_FORMAT if invalid format', async () => {
      const res = await AudioCapture.processSharedFile('content://file.txt');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(EkweError.BAD_FORMAT);
    });

    it('returns SHARE_COPY_FAIL if empty uri', async () => {
      const res = await AudioCapture.processSharedFile('');
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(EkweError.SHARE_COPY_FAIL);
    });
  });
});
