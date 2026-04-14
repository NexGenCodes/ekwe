import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EkweButton } from '@/components/common/EkweButton';

export default function NotFoundScreen(): React.ReactElement {
  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-background-dark">
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View className="flex-1 items-center justify-center p-5">
        <Text className="text-2xl font-display text-foreground dark:text-foreground-dark mb-2">
          This screen doesn't exist.
        </Text>
        <Text className="text-base text-center font-body text-muted dark:text-muted-dark mb-8">
          The link you followed may be broken, or the page may have been
          removed.
        </Text>

        <Link href="/" asChild>
          <EkweButton
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
