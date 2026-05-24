import { useSelector } from '@legendapp/state/react';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { EkweLogo } from '@/components/EkweLogo';
import { AccountStatusPill } from '@/components/ui/AccountStatusPill';
import { spacing } from '@/constants/designTokens';
import { useTheme } from '@/hooks';
import { SyncService } from '@/services/SyncService';

export function HomeHeader(): React.ReactElement {
  const { color } = useTheme();
  const pendingCount = useSelector(() => SyncService.pendingCount.get());

  return (
    <View style={styles.container}>
      <View style={styles.leftGroup}>
        <View style={[styles.iconBox, { backgroundColor: color.primary }]}>
          <EkweLogo size={40} color={color.onPrimary} strokeWidth={2.5} />
        </View>
        <View>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: color.foreground }]}
          >
            Ekwe
          </Text>
          <View style={styles.subtitleRow}>
            <Text
              accessibilityRole="header"
              style={[styles.subtitle, { color: color.muted }]}
            >
              Ready to translate.
            </Text>
            {pendingCount > 0 && (
              <View style={[styles.syncBadge, { backgroundColor: color.primary }]}>
                <Text style={[styles.syncBadgeText, { color: color.onPrimary }]}>
                  {pendingCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <AccountStatusPill />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    marginBottom: spacing[8],
    overflow: 'hidden',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'DMSerifDisplay-Regular',
    fontSize: 32,
    letterSpacing: -0.2,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  subtitle: {
    fontFamily: 'Outfit-Medium',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  syncBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBadgeText: {
    fontFamily: 'Outfit-Bold',
    fontSize: 11,
  },
});
