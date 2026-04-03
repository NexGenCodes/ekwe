import { StyleProp, ViewStyle } from 'react-native';

export interface AudioWaveformProps {
  /** Array of amplitude values from 0 to 1 representing the waveform shape */
  amplitudes: number[];
  /** Current playback progress from 0 to 1 */
  progress: number;
  /** Overall height of the waveform container */
  height?: number;
  /** Width of the waveform container */
  width?: number;
  /** Callback when user interacts with the waveform to seek */
  onSeek?: (progress: number) => void;
  /** Optional container style */
  style?: StyleProp<ViewStyle>;
  /** Whether the waveform is interactable */
  interactive?: boolean;
}
