import { Zap } from 'lucide-react-native';
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { PlaybackControl } from '@/components/common';
import { getColor } from '@/constants/colors';
import { useSharedAudioPlayer } from '@/hooks/useSharedAudioPlayer';

export interface EchoConfigStepProps {
  audioUri: string | undefined;
  isResolving: boolean;
  isDark: boolean;
  onTranscribe: (duration: number, waveform: number[]) => void;
  children: React.ReactNode;
}

export const EchoConfigStep: React.FC<EchoConfigStepProps> = React.memo(
  ({ audioUri, isResolving, isDark, onTranscribe, children }) => {
    const player = useSharedAudioPlayer(audioUri || null);
    const brandPrimary = getColor('primary', isDark);

    return (
      <View>
        <PlaybackControl
          isPlaying={player.isPlaying}
          isDecoding={player.isDecoding}
          progress={player.progress}
          duration={player.duration}
          peaks={player.realWaveform}
          onTogglePlay={() =>
            player.isPlaying ? player.pause() : player.play()
          }
          onSeek={player.seek}
          isDark={isDark}
        />

        {children}

        <TouchableOpacity
          onPress={() => {
            if (player.isPlaying) player.pause();
            onTranscribe(player.duration, player.realWaveform);
          }}
          disabled={!player.isLoaded || isResolving}
          style={[
            styles.primaryAction,
            {
              backgroundColor: brandPrimary,
              opacity: player.isLoaded && !isResolving ? 1 : 0.6,
            },
          ]}
        >
          {(!player.isLoaded || isResolving) && (
            <ActivityIndicator
              size="small"
              color="#FFF"
              style={{ marginRight: 8 }}
            />
          )}
          <Zap size={18} color="#FFF" fill="#FFF" />
          <Text style={styles.primaryActionTxt}>
            {isResolving
              ? 'Preparing Audio...'
              : player.isLoaded
                ? 'Transcribe'
                : 'Decoding Audio...'}
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
    gap: 8,
    paddingVertical: 18,
    borderRadius: 20,
  },
  primaryActionTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
});
