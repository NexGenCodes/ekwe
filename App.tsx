import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightTokens } from 'src/constants/tokens';
import { initialiseSentry } from 'src/utils/sentry';

initialiseSentry();

SplashScreen.preventAutoHideAsync();

export default function App(): React.ReactElement | null {
  const [ready, setReady] = useState<boolean>(false);

  const [fontsLoaded, fontError] = useFonts({
    'DMSerifDisplay-Regular': require('./src/assets/fonts/DMSerifDisplay-Regular.ttf'),
    'Outfit-Regular': require('./src/assets/fonts/Outfit-Regular.ttf'),
    'Outfit-Medium': require('./src/assets/fonts/Outfit-Medium.ttf'),
    'SpaceMono-Regular': require('./src/assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
      setReady(true);
    }
  }, [fontsLoaded, fontError]);

  if (!ready) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.wordmark}>ekwe</Text>
      <Text style={styles.status}>Fonts: {fontsLoaded ? 'ok' : 'error'}</Text>
      {fontError !== null && fontError !== undefined && (
        <Text style={styles.error}>Font error: {fontError.message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightTokens.color.background.primary,
  },
  wordmark: {
    fontFamily: 'DMSerifDisplay-Regular',
    fontSize: lightTokens.font.size.display,
    color: lightTokens.color.brand.navy,
  },
  status: {
    fontFamily: 'Outfit-Regular',
    fontSize: lightTokens.font.size.body,
    color: lightTokens.color.text.secondary,
    marginTop: lightTokens.space[2],
  },
  error: {
    fontFamily: 'Outfit-Regular',
    fontSize: lightTokens.font.size.caption,
    color: lightTokens.color.status.error,
    marginTop: lightTokens.space[1],
  },
});
