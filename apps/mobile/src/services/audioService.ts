import {
  requestRecordingPermissionsAsync,
  getRecordingPermissionsAsync,
} from "expo-audio";

type PermissionStatus = "granted" | "denied" | "undetermined" | "restricted";

class AudioService {
  private static instance: AudioService;

  private constructor() {}

  public static getInstance(): AudioService {
    if (!AudioService.instance) {
      AudioService.instance = new AudioService();
    }
    return AudioService.instance;
  }

  public async checkPermission(): Promise<PermissionStatus> {
    const { status } = await getRecordingPermissionsAsync();
    return status as unknown as PermissionStatus;
  }

  public async requestPermission(): Promise<PermissionStatus> {
    const { status } = await requestRecordingPermissionsAsync();
    return status as unknown as PermissionStatus;
  }
}

export default AudioService.getInstance();
