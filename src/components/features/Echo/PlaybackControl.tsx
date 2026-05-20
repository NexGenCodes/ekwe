import { Play, Pause } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SharedValue } from 'react-native-reanimated';

import { AudioWaveform as ReanimatedWaveform } from '@/components/ui';
import { fonts } from '@/constants/fonts';
import { useTheme } from '@/hooks';
import { formatDuration } from '@/utils/echo';

interface PlaybackControlProps {
  isPlaying: boolean;
  isDecoding: boolean;
  progress: number;
  progressSV: SharedValue<number>;
  duration: number;
  peaks: number[];
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
}

/**
 * PlaybackControl
 *
 * A reusable audio control bar with play/pause, waveform, and time tracking.
 */
export const PlaybackControl: React.FC<PlaybackControlProps> = ({
  isPlaying,
  isDecoding,
  progress,
  progressSV,
  duration,
  peaks,
  onTogglePlay,
  onSeek,
}) => {
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const { color } = useTheme();

  return (
    <View
      style={[
        styles.playerBox,
        { backgroundColor: color.background, borderColor: color.border },
      ]}
    >
      <View style={styles.playerRow}>
        <TouchableOpacity
          onPress={onTogglePlay}
          disabled={isDecoding}
          style={[
            styles.playBtn,
            { backgroundColor: color.secondary, opacity: isDecoding ? 0.5 : 1 },
          ]}
        >
          {isDecoding ? (
            <ActivityIndicator size="small" color={color.primary} />
          ) : isPlaying ? (
            <Pause
              size={18}
              color={color.onSecondary}
              fill={color.onSecondary}
            />
          ) : (
            <Play
              size={18}
              color={color.onSecondary}
              fill={color.onSecondary}
            />
          )}
        </TouchableOpacity>

        <View style={styles.waveformContainer}>
          <ReanimatedWaveform
            amplitudes={peaks}
            progressSV={progressSV}
            duration={duration}
            onSeeking={(normalizedProgress) => {
              setScrubTime(normalizedProgress * duration);
            }}
            onSeek={(normalizedProgress) => {
              const targetTime = normalizedProgress * duration;
              setScrubTime(null);
              onSeek(targetTime);
            }}
          />
        </View>

        <Text style={[styles.timeTxt, { color: color.secondary }]}>
          {formatDuration(scrubTime !== null ? scrubTime : progress)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  playerBox: {
    borderRadius: 24,
    borderWidth: 1.5,
    overflow: 'hidden',
    marginBottom: 20,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformContainer: {
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  timeTxt: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    width: 50,
    textAlign: 'right',
  },
});
