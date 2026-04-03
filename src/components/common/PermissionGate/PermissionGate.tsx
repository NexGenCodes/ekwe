import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EkweButton } from 'src/components/common/EkweButton';
import { useTheme } from 'src/hooks/useTheme';

import { PermissionGateProps } from './PermissionGate.types';

export const PermissionGate = ({
  icon,
  heading,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  style,
}: PermissionGateProps): React.ReactElement => {
  const { tokens } = useTheme();

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: tokens.color.background.primary },
        style,
      ]}
    >
      <View style={styles.content}>
        <View style={styles.innerContent}>
          <View style={styles.iconContainer}>{icon}</View>

          <Text
            style={[
              styles.heading,
              {
                fontFamily: tokens.font.family.bodyMed,
                fontSize: tokens.font.size.heading,
                lineHeight: tokens.font.lineHeight.heading,
                color: tokens.color.text.primary,
                marginTop: tokens.space[4],
              },
            ]}
          >
            {heading}
          </Text>

          <Text
            style={[
              styles.body,
              {
                fontFamily: tokens.font.family.body,
                fontSize: tokens.font.size.body,
                lineHeight: tokens.font.lineHeight.body,
                color: tokens.color.text.secondary,
                marginTop: tokens.space[3],
              },
            ]}
          >
            {body}
          </Text>

          <EkweButton
            variant="primary"
            size="large"
            label={primaryLabel}
            onPress={onPrimary}
            style={styles.primaryButton}
          />

          {secondaryLabel && onSecondary && (
            <EkweButton
              variant="ghost"
              size="medium"
              label={secondaryLabel}
              onPress={onSecondary}
              style={styles.secondaryButton}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  innerContent: {
    width: '100%',
    maxWidth: 300,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  heading: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: 280,
  },
  primaryButton: {
    width: '100%',
    marginTop: 32,
  },
  secondaryButton: {
    width: '100%',
    marginTop: 12,
  },
});
