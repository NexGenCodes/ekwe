import * as FileSystem from 'expo-file-system';
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

import {
  attachAudioEffects,
  releaseAudioEffects,
} from '@/utils/AudioEffectsModule';

type PermissionStatus = 'Granted' | 'Denied' | 'Undetermined' | 'Restricted';

class AudioService {
  private static instance: AudioService;
  private context: AudioContext | null = null;
  private recorder: AudioRecorder | null = null;
  private analyser: AnalyserNode | null = null;
  private recordingPath: string | null = null;

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
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP', 'mixWithOthers'],
        iosMode: 'voiceChat',
      });
      await AudioManager.setAudioSessionActivity(true);
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

  public async startRecording(): Promise<string> {
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
      console.error(`FileOutput Error: ${result.message}`);
      throw new Error(`Failed to enable file output: ${result.message}`);
    }

    this.recordingPath = result.path;

    const startResult = this.recorder.start();
    if (startResult.status !== 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Recording start failed:', startResult.message);
      throw new Error(`Failed to start recording: ${startResult.message}`);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    return this.recordingPath;
  }

  public async stopRecording(): Promise<{ path: string; duration: number }> {
    if (!this.recorder || !this.recorder.isRecording()) {
      throw new Error('Recorder not initialized or not recording');
    }

    const result = this.recorder.stop();
    if (result.status !== 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error('Recording stop failed:', result.message);
      throw new Error('Failed to stop recording: ' + result.message);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const duration = result.duration * 1000; // Convert to ms
    const path = result.path;
    this.recordingPath = null;

    // Optimal Performance: Suspend context when not in use
    if (this.context && this.context.state === 'running') {
      try {
        await this.context.suspend();
      } catch (e) {
        console.warn('AudioContext suspend failed:', e);
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
      // PRO-TIP: We use a type cast here as expo-file-system 55 constants
      // sometimes have resolution issues with * as imports in certain TS configs.
      const cacheDir = (FileSystem as unknown as { cacheDirectory: string })
        .cacheDirectory;
      if (!cacheDir) return;

      const files = await FileSystem.readDirectoryAsync(cacheDir);
      const audioFiles = files.filter(
        (f) => f.startsWith('rec_') && f.endsWith('.m4a'),
      );

      if (audioFiles.length === 0) return;

      for (const file of audioFiles) {
        // Ensure path separator is handled correctly
        const fileUri = cacheDir.endsWith('/')
          ? `${cacheDir}${file}`
          : `${cacheDir}/${file}`;
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      }
    } catch (error) {
      console.error('Cache purge failed:', error);
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
