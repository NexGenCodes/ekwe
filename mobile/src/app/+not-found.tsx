import { Link, Stack } from "expo-router";

import { Button } from "@/components";
import { Box, Text, SafeArea } from "@/components/ui";
import { spacing } from "@/constants/spacing";
import { useTheme } from "@/hooks";

export default function NotFoundScreen(): React.ReactElement {
  const { color } = useTheme();

  return (
    <SafeArea style={[styles.container, { backgroundColor: color.background }]}>
      <Stack.Screen options={{ title: "Oops!" }} />
      <Box style={styles.content}>
        <Text variant="heading2" style={styles.title}>
          This screen doesn't exist.
        </Text>
        <Text variant="body" style={[styles.subtitle, { color: color.muted }]}>
          The link you followed may be broken, or the page may have been
          removed.
        </Text>

        <Link href="/" asChild>
          <Button
            variant="primary"
            size="large"
            label="Go to home screen!"
            onPress={(): void => {}}
          />
        </Link>
      </Box>
    </SafeArea>
  );
}

const styles = {
  container: { flex: 1 } as const,
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  } as const,
  title: { marginBottom: spacing.sm } as const,
  subtitle: {
    textAlign: "center",
    marginBottom: spacing.xl,
  } as const,
};
