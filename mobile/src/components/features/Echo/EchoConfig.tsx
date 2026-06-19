import { Zap } from "lucide-react-native";
import React from "react";

import { PlaybackControl } from "./PlaybackControl";

import { Box, Text, Pressable, Spinner } from "@/components/ui";
import { borderRadius, opacity } from "@/constants/sizes";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";
import { SharedAudioPlayer } from "@/hooks/audio/useSharedAudioPlayer";

export interface EchoConfigStepProps {
  player: SharedAudioPlayer;
  isResolving: boolean;
  isDark: boolean;
  peaks: number[];
  onTranscribe: (duration: number, waveform: number[]) => void;
  children: React.ReactNode;
}

export const EchoConfigStep: React.FC<EchoConfigStepProps> = React.memo(
  ({ player, isResolving, isDark, peaks, onTranscribe, children }) => {
    const { color } = useTheme();
    return (
      <Box>
        <PlaybackControl
          isPlaying={player.isPlaying}
          isDecoding={player.isDecoding || isResolving}
          progress={player.progress}
          progressSV={player.progressSV}
          duration={player.duration}
          peaks={peaks}
          onTogglePlay={() =>
            player.isPlaying ? player.pause() : player.play()
          }
          onSeek={player.seek}
        />

        {children}

        <Pressable
          feedback="opacity"
          onPress={() => {
            player.cleanup();
            onTranscribe(player.duration, peaks);
          }}
          disabled={isResolving}
          style={{
            flexDirection: "row",
            justifyContent: "center",
            alignItems: "center",
            gap: spacing.sm,
            paddingVertical: spacing.md,
            borderRadius: borderRadius["2xl"],
            backgroundColor: color.brand,
            opacity: isResolving ? opacity.inactive : 1,
          }}
        >
          {isResolving && (
            <Spinner
              size="sm"
              color={color.onBrand}
              style={{ marginRight: spacing.sm }}
            />
          )}
          <Zap size={18} color={color.onBrand} fill={color.onBrand} />
          <Text variant="body" style={{ color: color.onBrand }}>
            {isResolving ? "Preparing Audio..." : "Transcribe"}
          </Text>
        </Pressable>
      </Box>
    );
  },
);
