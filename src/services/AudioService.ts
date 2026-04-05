import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import {
  AudioContext,
  AudioRecorder,
  AnalyserNode,
  FilePreset,
  AudioManager,
  FileDirectory,
} from 'react-native-audio-api';

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

  public async checkPermission(): Promise<boolean> {
    const status = await AudioManager.checkRecordingPermissions();
    return status === 'Granted';
  }

  public async requestPermission(): Promise<boolean> {
    const status = await AudioManager.requestRecordingPermissions();
    return status === 'Granted';
  }

  public async initialize(): Promise<void> {
    if (this.context) return;

    this.context = new AudioContext();

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
    // Note: Analysis happens via the adapter/analyser chain
    const adapter = this.context.createRecorderAdapter();
    this.recorder.connect(adapter);
    adapter.connect(this.analyser);
  }

  public async startRecording(): Promise<string> {
    const isGranted = await this.checkPermission();
    if (!isGranted) {
      const requestedSelection = await this.requestPermission();
      if (!requestedSelection) throw new Error('Permission denied');
    }

    await this.initialize();
    if (!this.recorder) throw new Error('Recorder not initialized');

    const fileName = `rec_${Date.now()}.m4a`;
    this.recordingPath = `${Paths.cache.uri}/${fileName}`;

    // Note: SWM Audio API 0.11+ uses directory/fileNamePrefix or start(fileNameOverride)
    const result = this.recorder.enableFileOutput({
      directory: FileDirectory.Cache,
      fileNamePrefix: `rec_${Date.now()}`,
      preset: FilePreset.High,
    });

    if (result.status !== 'success') {
      throw new Error('Failed to enable file output: ' + result.message);
    }

    this.recordingPath = result.path;

    const startResult = this.recorder.start();
    if (startResult.status !== 'success') {
      throw new Error('Failed to start recording: ' + startResult.message);
    }

    return this.recordingPath;
  }

  public async stopRecording(): Promise<{ path: string; duration: number }> {
    if (!this.recorder || !this.recorder.isRecording()) {
      throw new Error('Recorder not initialized or not recording');
    }

    const result = this.recorder.stop();
    if (result.status !== 'success') {
      throw new Error('Failed to stop recording: ' + result.message);
    }

    const duration = result.duration * 1000; // Convert to ms
    const path = result.path;
    this.recordingPath = null;

    return { path, duration };
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
    }
  }
}

export default AudioService.getInstance();
