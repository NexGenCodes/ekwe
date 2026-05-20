import { Link, Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { useTheme } from '@/hooks';

export default function NotFoundScreen(): React.ReactElement {
  const { color } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: color.background }]}
    >
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: color.foreground }]}>
          This screen doesn't exist.
        </Text>
        <Text style={[styles.subtitle, { color: color.muted }]}>
          The link you followed may be broken, or the page may have been
          removed.
        </Text>

        <Link href="/" asChild>
          <Button
            variant="primary"
            size="large"
            label="Go to home screen!"
            onPress={function (): void {
              throw new Error('Function not implemented.');
            }}
          />
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: { fontSize: 24, fontFamily: 'Outfit-Medium', marginBottom: 8 },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Outfit-Regular',
    textAlign: 'center',
    marginBottom: 32,
  },
});
