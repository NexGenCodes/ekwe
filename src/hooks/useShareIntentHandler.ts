import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { RootStackParams } from 'src/navigation/types';
import { AudioCapture } from 'src/services/AudioCapture';

type Nav = NativeStackNavigationProp<RootStackParams>;

export const useShareIntentHandler = (): void => {
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntent();
  const navigation = useNavigation<Nav>();

  interface RawIntent {
    value?: string;
    files?: { path: string }[];
    data?: string;
    type?: string;
  }

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[ShareIntent] Error:', error);
    }
  }, [error]);

  useEffect(() => {
    const rawIntent = shareIntent as RawIntent;
    if (hasShareIntent && rawIntent) {
      const handleIncomingAudio = async (): Promise<void> => {
        const uri =
          rawIntent.value || rawIntent.files?.[0]?.path || rawIntent.data;
        if (!uri) return;
        // Strict Voice Note Validation
        const result = await AudioCapture.processSharedFile(uri);

        if (result.ok) {
          navigation.navigate('Main', {
            screen: 'Result',
            params: {
              entryId: `share_${Date.now()}`,
              isLive: false,
            },
          });

          // Reset so it doesn't trigger again on reload
          resetShareIntent();
        } else {
          Alert.alert(
            'Invalid Format',
            'Ekwe only supports voice notes (.m4a, .opus, .ogg, .aac). Music files are not allowed.',
            [{ text: 'OK', onPress: () => resetShareIntent() }],
          );
        }
      };

      handleIncomingAudio();
    }
  }, [hasShareIntent, shareIntent, navigation, resetShareIntent]);

  return undefined;
};
