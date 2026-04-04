import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  PermissionResponse,
} from 'expo-audio';
import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { MicrophoneIcon } from 'src/assets/icons/MicrophoneIcon';
import { PermissionGate } from 'src/components/common/PermissionGate';
import { useTheme } from 'src/hooks/useTheme';
import { OnboardingScreenProps } from 'src/navigation/types';

export const MicrophoneScreen = ({
  navigation,
}: OnboardingScreenProps<'Microphone'>): React.ReactElement => {
  const { tokens } = useTheme();
  const [, setPermission] = useState<PermissionResponse | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async (): Promise<void> => {
      const res = await getRecordingPermissionsAsync();
      setPermission(res);
      if (res.granted) {
        navigation.navigate('Language');
      }
    })();
  }, [navigation]);

  const handleRequest = async (): Promise<void> => {
    const result = await requestRecordingPermissionsAsync();
    setPermission(result);
    if (result.granted) {
      navigation.navigate('Language');
    } else {
      setDenied(true);
    }
  };

  const modeProps = denied
    ? {
        icon: (
          <MicrophoneIcon
            size={64}
            color={tokens.color.status.error}
            strokeWidth={1.5}
          />
        ),
        heading: 'Microphone access denied',
        body: 'Enable it in Settings to use Ekwe.',
        primaryLabel: 'Open Settings',
        onPrimary: (): void => {
          Linking.openSettings();
        },
        secondaryLabel: 'Try again',
        onSecondary: handleRequest,
      }
    : {
        icon: (
          <MicrophoneIcon
            size={64}
            color={tokens.color.brand.core}
            strokeWidth={1.5}
          />
        ),
        heading: 'Ekwe needs your microphone',
        body: 'To capture voice notes playing around you. Your audio is processed on-device and never stored.',
        primaryLabel: 'Enable microphone',
        onPrimary: handleRequest,
      };

  return <PermissionGate {...modeProps} />;
};
