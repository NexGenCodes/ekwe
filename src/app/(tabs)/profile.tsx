import { useSelector } from '@legendapp/state/react';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as StoreReview from 'expo-store-review';
import {
  LogOut,
  CreditCard,
  History,
  Trash2,
  ChevronRight,
  Mail,
  Shield,
  FileText,
  Star,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import {
  AvatarPickerModal,
  AVATAR_ICONS,
  ProfileRow,
  ProfileSection,
  ProfileIdentity,
} from '@/components';
import { useLogout, useTheme, usePermissions } from '@/hooks';
import { deleteAccount } from '@/services/auth';
import { supabase } from '@/services/supabase';
import { auth$, authActions } from '@/store';
import { AppAlert } from '@/utils/alert';
import logger from '@/utils/logger';

// ─── ProfileScreen ────────────────────────────────────────────────────────────

export default function ProfileScreen(): React.JSX.Element {
  const user = useSelector(() => auth$.user.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const router = useRouter();
  const { color } = useTheme();
  const permissions = usePermissions();
  const { confirmLogout } = useLogout();

  const rawName =
    user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  const userEmail = user?.email || '';
  // Fallback to the first part of their email if name is completely empty
  const fallbackName = userEmail.split('@')[0] || 'User';
  const userName = rawName ? rawName.split(' ')[0] : fallbackName;

  const [isIconModalVisible, setIsIconModalVisible] = useState(false);

  const currentIconData = user?.user_metadata?.avatar_icon
    ? AVATAR_ICONS.find((i) => i.name === user?.user_metadata?.avatar_icon)
    : null;

  const handleUpdateIcon = async (iconName: string): Promise<void> => {
    setIsIconModalVisible(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { avatar_icon: iconName || null },
      });
      if (error) throw error;
      if (data.user) authActions.setUser(data.user);
    } catch (e) {
      logger.error('Failed to update avatar icon:', e);
      AppAlert.error('Error', 'Could not update your avatar.');
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    AppAlert.confirm(
      'Delete Account',
      'This will permanently delete your account and all associated data. This action cannot be undone. Are you sure?',
      async () => {
        const result = await deleteAccount();
        if (!result.ok) {
          AppAlert.error(
            'Action Required',
            result.error || 'Failed to delete account.',
          );
        } else {
          router.replace('/(auth)/login');
        }
      },
      { confirmText: 'Delete Permanently', isDestructive: true },
    );
  };

  return (
    <View style={[styles.flex1, { backgroundColor: color.background }]}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
      >
        <ProfileIdentity
          user={user}
          isPro={isPro}
          currentIconData={currentIconData}
          userName={userName}
          userEmail={userEmail}
          rawName={rawName}
          onEditAvatar={() => {
            if (permissions.customAvatarIcons) {
              setIsIconModalVisible(true);
            } else {
              AppAlert.info(
                'Ekwe Pro',
                'Custom avatar icons are a premium feature. Upgrade to Pro to customize your profile.',
              );
            }
          }}
        />

        {/* Activity & Plan */}
        <ProfileSection title="Activity & Plan" delay={300}>
          <ProfileRow
            icon={History}
            sfIcon="clock.fill"
            iconColor={color.primary}
            title="Translation History"
            subtitle="Review your recent translations"
            hasDivider
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(tabs)/history');
            }}
          />
          <ProfileRow
            icon={CreditCard}
            sfIcon="creditcard.fill"
            iconColor={color.primary}
            title={isPro ? 'Ekwe Pro' : 'Plan & Billing'}
            subtitle={
              isPro ? 'Unlimited translations' : 'Free Tier · Standard limits'
            }
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/billing');
            }}
            trailing={
              isPro ? (
                process.env.EXPO_OS === 'ios' ? (
                  <ExpoImage
                    source="sf:chevron.right"
                    style={{ width: 14, height: 14 }}
                    tintColor={color.muted}
                  />
                ) : (
                  <ChevronRight size={20} color={color.muted} />
                )
              ) : (
                <View
                  style={[
                    styles.upgradeBadge,
                    { backgroundColor: color.primary },
                  ]}
                >
                  <Text
                    style={[styles.upgradeText, { color: color.onPrimary }]}
                  >
                    Upgrade
                  </Text>
                </View>
              )
            }
          />
        </ProfileSection>

        {/* Help & Legal */}
        <ProfileSection title="Help & Legal" delay={350}>
          <ProfileRow
            icon={Mail}
            sfIcon="envelope.fill"
            iconColor={color.primary}
            title="Contact Support"
            hasDivider
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Linking.openURL('mailto:emmanuelztrd@gmail.com');
            }}
          />
          <ProfileRow
            icon={Star}
            sfIcon="star.fill"
            iconColor={color.primary}
            title="Rate Us"
            hasDivider
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              let hasNativeAction = false;
              try {
                hasNativeAction = await StoreReview.hasAction();
              } catch {
                logger.warn(
                  'StoreReview native module not found, falling back to Linking',
                );
              }

              if (hasNativeAction) {
                try {
                  await StoreReview.requestReview();
                  return;
                } catch {
                  logger.warn(
                    'StoreReview request failed, falling back to Linking',
                  );
                }
              }

              // Fallback to deep link
              const ITUNES_ITEM_ID = '123456789'; // TODO: Replace with your actual numeric iOS App ID when published to App Store Connect
              const ANDROID_PACKAGE_NAME =
                Constants.expoConfig?.android?.package ?? 'com.anonymous.ekwe';

              const url =
                Platform.OS === 'ios'
                  ? `itms-apps://itunes.apple.com/app/viewContentsUserReviews?id=${ITUNES_ITEM_ID}&action=write-review`
                  : `market://details?id=${ANDROID_PACKAGE_NAME}`;
              Linking.openURL(url).catch(() => {
                AppAlert.error('Error', 'Could not open the app store.');
              });
            }}
          />
          <ProfileRow
            icon={Shield}
            sfIcon="shield.fill"
            iconColor={color.primary}
            title="Privacy Policy"
            hasDivider
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/legal/privacy');
            }}
          />
          <ProfileRow
            icon={FileText}
            sfIcon="doc.text.fill"
            iconColor={color.primary}
            title="Terms of Service"
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/legal/terms');
            }}
          />
        </ProfileSection>

        {/* Danger Zone */}
        <ProfileSection
          title="Danger Zone"
          titleColor={color.error}
          delay={400}
        >
          <ProfileRow
            icon={LogOut}
            sfIcon="rectangle.portrait.and.arrow.right"
            iconColor={color.error}
            title="Log Out"
            subtitle="Sign out of your session"
            hasDivider
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              confirmLogout();
            }}
            trailing={null}
          />
          <ProfileRow
            icon={Trash2}
            sfIcon="trash.fill"
            iconColor={color.error}
            title="Delete Account"
            subtitle="Permanently delete your data"
            onPress={handleDeleteAccount}
            trailing={null}
          />
        </ProfileSection>

        {/* Footer */}
        <Animated.View
          entering={FadeInUp.delay(450).duration(400)}
          style={styles.footer}
        >
          <Text style={[styles.footerText, { color: color.muted }]}>
            Built with ❤️ by EKWE team
          </Text>
          <Text style={[styles.versionText, { color: color.muted }]}>
            v{Constants.expoConfig?.version ?? '1.0.0'}
          </Text>
        </Animated.View>
      </ScrollView>

      <AvatarPickerModal
        visible={isIconModalVisible}
        onClose={() => setIsIconModalVisible(false)}
        onSelect={handleUpdateIcon}
        currentIcon={user?.user_metadata?.avatar_icon}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  upgradeBadge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  upgradeText: { fontFamily: 'Outfit-Medium', fontSize: 12 },
  footer: { alignItems: 'center', paddingBottom: 32 },
  footerText: { fontFamily: 'Outfit-Medium', fontSize: 12, opacity: 0.6 },
  versionText: {
    fontFamily: 'Outfit-Regular',
    fontSize: 10,
    opacity: 0.4,
    marginTop: 4,
  },
});
