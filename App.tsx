import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Switch } from 'react-native';
import { lightTokens } from 'src/constants/tokens';
import { useStore } from 'src/store';
import { loadVADModel } from 'src/utils/loadVADModel';
import { initialiseSentry } from 'src/utils/sentry';

// Initialise Sentry before anything renders
initialiseSentry();

// Keep splash visible while loading
SplashScreen.preventAutoHideAsync();

export default function App(): React.JSX.Element {
  const [vadLoaded, setVadLoaded] = useState<boolean>(false);
  const [vadStatus, setVadStatus] = useState<string>('Loading VAD…');

  const bubbleEnabled = useStore((s) => s.bubbleEnabled);
  const setBubbleEnabled = useStore((s) => s.setBubbleEnabled);

  const [fontsLoaded] = useFonts({
    'DMSerifDisplay-Regular': require('./src/assets/fonts/DMSerifDisplay-Regular.ttf'),
    'Outfit-Regular': require('./src/assets/fonts/Outfit-Regular.ttf'),
    'Outfit-Medium': require('./src/assets/fonts/Outfit-Medium.ttf'),
    'SpaceMono-Regular': require('./src/assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect((): void => {
    const initVAD = async (): Promise<void> => {
      const result = await loadVADModel();
      if (result.ok) {
        setVadLoaded(true);
        setVadStatus('VAD model loaded successfully');
      } else {
        setVadLoaded(true);
        setVadStatus(`VAD load failed: ${result.error}`);
        Sentry.captureException(new Error(`VAD load failed: ${result.error}`));
      }
    };

    initVAD();
  }, []);

  useEffect((): void => {
    if (fontsLoaded && vadLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, vadLoaded]);

  if (!fontsLoaded || !vadLoaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ekwe</Text>
      <Text style={styles.status}>{vadStatus}</Text>

      <View style={{ marginTop: 40, alignItems: 'center' }}>
        <Text style={[styles.status, { marginBottom: 10 }]}>
          MMKV Test: Bubble Enabled
        </Text>
        <Switch value={bubbleEnabled} onValueChange={setBubbleEnabled} />
        <Text style={{ marginTop: 10, color: '#888', textAlign: 'center' }}>
          Toggle this, trigger a hot reload, and verify the state persists.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightTokens.color.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'DMSerifDisplay-Regular',
    fontSize: lightTokens.font.size.display,
    color: lightTokens.color.brand.navy,
    marginBottom: lightTokens.space[2],
  },
  status: {
    fontFamily: 'Outfit-Regular',
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.secondary,
  },
});
