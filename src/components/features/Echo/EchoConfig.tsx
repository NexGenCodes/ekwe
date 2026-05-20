import { Zap } from 'lucide-react-native';
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { PlaybackControl } from './PlaybackControl';

import { useTheme } from '@/hooks';
import { SharedAudioPlayer } from '@/hooks/audio/useSharedAudioPlayer';

export interface EchoConfigStepProps {
  player: SharedAudioPlayer;
  isResolving: boolean;
  isDark: boolean;
  onTranscribe: (duration: number, waveform: number[]) => void;
  children: React.ReactNode;
}

export const EchoConfigStep: React.FC<EchoConfigStepProps> = React.memo(
  ({ player, isResolving, onTranscribe, children }) => {
    const { color } = useTheme();
    return (
      <View>
        <PlaybackControl
          isPlaying={player.isPlaying}
          isDecoding={player.isDecoding}
          progress={player.progress}
          progressSV={player.progressSV}
          duration={player.duration}
          peaks={player.realWaveform}
          onTogglePlay={() =>
            player.isPlaying ? player.pause() : player.play()
          }
          onSeek={player.seek}
        />

        {children}

        <TouchableOpacity
          onPress={() => {
            player.cleanup();
            onTranscribe(player.duration, player.realWaveform);
          }}
          disabled={isResolving}
          style={[
            styles.primaryAction,
            {
              backgroundColor: color.secondary,
              opacity: isResolving ? 0.6 : 1,
            },
          ]}
        >
          {isResolving && (
            <ActivityIndicator
              size="small"
              color={color.onPrimary}
              style={{ marginRight: 8 }}
            />
          )}
          <Zap size={18} color={color.onPrimary} fill={color.onPrimary} />
          <Text style={[styles.primaryActionTxt, { color: color.onPrimary }]}>
            {isResolving ? 'Preparing Audio...' : 'Transcribe'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  primaryAction: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 24,
  },
  primaryActionTxt: {
    fontFamily: 'Outfit-Bold',
    fontSize: 17,
    letterSpacing: -0.2,
  },
});
