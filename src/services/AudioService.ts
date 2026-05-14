import { Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import {
  AudioContext,
  AudioRecorder,
  AnalyserNode,
  FilePreset,
  AudioManager,
  FileDirectory,
} from 'react-native-audio-api';

import { logger } from '@/utils';
import { releaseAudioEffects } from '@/utils/AudioEffectsModule';

type PermissionStatus = 'Granted' | 'Denied' | 'Undetermined' | 'Restricted';

class AudioService {
  private static instance: AudioService;
  private context: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private analyser: AnalyserNode | null = null;

  private constructor() {}

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  public async checkPermission(): Promise<PermissionStatus> {
    return (await AudioManager.checkRecordingPermissions()) as PermissionStatus;
  }

  public async requestPermission(): Promise<PermissionStatus> {
    return (await AudioManager.requestRecordingPermissions()) as PermissionStatus;
  }

  public async initialize(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }
      return;
    }

    this.context = new AudioContext();

    // Explicitly resume on creation if needed
    if (Platform.OS === 'ios') {
      await this.context.resume();
    }

    // 1. Configure Global Audio Session (iOS)
    if (Platform.OS === 'ios') {
      try {
        await AudioManager.setAudioSessionOptions({
          iosCategory: 'playAndRecord',
          iosOptions: [
            'defaultToSpeaker',
            'allowBluetoothHFP',
            'mixWithOthers',
          ],
          iosMode: 'videoChat', // videoChat is often more reliable for speaker routing than voiceChat
        });
        await AudioManager.setAudioSessionActivity(true);
      } catch (e) {
        logger.warn('AudioSession configuration failed:', e);
      }
    }

    // 2. Initialize Nodes
    this.recorder = new AudioRecorder();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;

    // 3. Connect Graph: Recorder -> Adapter -> Analyser
    const adapter = this.context.createRecorderAdapter();
    this.recorder.connect(adapter);
    adapter.connect(this.analyser);
  }

  public async startRecording(): Promise<void> {
    const status = await this.checkPermission();
    if (status !== 'Granted') {
      const result = await this.requestPermission();
      if (result !== 'Granted') throw new Error('Permission denied');
    }

    await this.initialize();
    if (!this.recorder) throw new Error('Recorder not initialized');

    // SWM Audio API 0.11+ handle file output
    const timestamp = Date.now();
    const result = this.recorder.enableFileOutput({
      directory: FileDirectory.Cache,
      fileNamePrefix: `rec_${timestamp}`,
      preset: FilePreset.High,
    });

    if (result.status !== 'success') {
      logger.error(`FileOutput Error: ${result.message}`);
      throw new Error(`Failed to enable file output: ${result.message}`);
    }

    const startResult = this.recorder.start();
    if (startResult.status !== 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      logger.error('Recording start failed:', startResult.message);
      throw new Error(`Failed to start recording: ${startResult.message}`);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  public async stopRecording(): Promise<{ path: string; duration: number }> {
    if (!this.recorder || !this.recorder.isRecording()) {
      throw new Error('Recorder not initialized or not recording');
    }

    const result = this.recorder.stop();
    if (result.status !== 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      logger.error('Recording stop failed:', result.message);
      throw new Error('Failed to stop recording: ' + result.message);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const duration = result.duration * 1000; // Convert to ms
    const path = result.paths[0];

    // Optimal Performance: Suspend context when not in use
    if (this.context && this.context.state === 'running') {
      try {
        await this.context.suspend();
      } catch (e) {
        logger.warn('AudioContext suspend failed:', e);
      }
    }

    // Gracefully release native audio effects
    await releaseAudioEffects();

    return { path, duration };
  }

  /**
   * Purges old recording files from the Cache directory to prevent storage bloat.
   */
  public async purgeCache(): Promise<void> {
    try {
      const cacheDir = Paths.cache;
      if (!cacheDir) return;

      const files = cacheDir.list();
      const audioFiles = files.filter(
        (f) =>
          !('isDirectory' in f) &&
          f.name.startsWith('rec_') &&
          f.name.endsWith('.m4a'),
      );

      if (audioFiles.length === 0) return;

      for (const file of audioFiles) {
        if (file.exists) file.delete();
      }
    } catch (error) {
      logger.error('Cache purge failed:', error);
    }
  }

  public getMetering(): number {
    if (!this.analyser) return -160;

    const dataArray = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -160;
    return db;
  }

  public isRecording(): boolean {
    return this.recorder?.isRecording() || false;
  }

  public async cleanup(): Promise<void> {
    if (this.context) {
      if (this.recorder?.isRecording()) {
        this.recorder.stop();
      }
      await this.context.close();
      this.context = null;
      this.recorder = null;
      this.analyser = null;
      releaseAudioEffects();
    }
  }
}

export default AudioService.getInstance();
