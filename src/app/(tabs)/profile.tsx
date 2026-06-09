import { useSelector } from "@legendapp/state/react";
import Constants from "expo-constants";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import {
  LogOut,
  CreditCard,
  Trash2,
  ChevronRight,
  Mail,
  Shield,
  FileText,
  Star,
  Palette,
  Copy,
  Globe,
  Eye,
  Smartphone,
} from "lucide-react-native";
import React, { useState, useCallback } from "react";
import { Linking, Modal, Switch, TextInput } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import {
  AvatarPickerModal,
  AVATAR_ICONS,
  ProfileRow,
  ProfileSection,
  ProfileIdentity,
  CurrencyPickerModal,
  ThemePickerModal,
} from "@/components";
import { Box, Text, Pressable, ScrollArea } from "@/components/ui";
import {
  duration,
  borderRadius,
  opacity,
  spacing,
  SUPPORTED_CURRENCIES,
} from "@/constants";
import { useLogout, useTheme, usePermissions, useForegroundApp } from "@/hooks";
import { deleteAccount } from "@/services/auth";
import { supabase } from "@/services/supabase";
import { auth$, authActions, settings$, settingsActions } from "@/store";
import { isIOS } from "@/utils";
import { AppAlert } from "@/utils/alert";
import { triggerHaptic } from "@/utils/haptics";
import logger from "@/utils/logger";

// ─── ProfileScreen ────────────────────────────────────────────────────────────

export default function ProfileScreen(): React.JSX.Element {
  const user = useSelector(() => auth$.user.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const router = useRouter();
  const { color, colorScheme, setColorScheme } = useTheme();
  const permissions = usePermissions();
  const { confirmLogout } = useLogout();

  const hapticsEnabled = useSelector(() => settings$.hapticsEnabled.get());
  const currency = useSelector(() => settings$.currency.get());
  const { setHapticsEnabled, setAutoCopy, setCurrency } = settingsActions;
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const autoCopy = useSelector(() => settings$.autoCopy.get());
  const { hasPermission } = useForegroundApp();

  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [isThemeModalVisible, setIsThemeModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const rawName =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "";
  const userEmail = user?.email || "";
  // Fallback to the first part of their email if name is completely empty
  const fallbackName = userEmail.split("@")[0] || "User";
  const userName = rawName ? rawName.split(" ")[0] : fallbackName;

  const [isIconModalVisible, setIsIconModalVisible] = useState(false);

  const currentIconData = user?.user_metadata?.avatar_icon
    ? (AVATAR_ICONS.find((i) => i.name === user?.user_metadata?.avatar_icon) ??
      null)
    : null;

  const handleUpdateIcon = async (iconName: string): Promise<void> => {
    setIsIconModalVisible(false);
    await triggerHaptic();
    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { avatar_icon: iconName || null },
      });
      if (error) throw error;
      if (data.user) authActions.setUser(data.user);
    } catch (e) {
      logger.error("Failed to update avatar icon:", e);
      AppAlert.error("Error", "Could not update your avatar.");
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    await triggerHaptic();
    setDeleteConfirmText("");
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = useCallback(async (): Promise<void> => {
    setShowDeleteModal(false);
    const result = await deleteAccount();
    if (!result.ok) {
      AppAlert.error(
        "Action Required",
        result.error || "Failed to delete account.",
      );
    } else {
      router.replace("/(auth)/login");
    }
  }, [router]);

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <ScrollArea
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xl,
        }}
      >
        <Animated.View entering={FadeInDown.duration(duration.normal)}>
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
                  "Ekwe Pro",
                  "Custom avatar icons are a premium feature. Upgrade to Pro to customize your profile.",
                );
              }
            }}
          />
        </Animated.View>

        {/* Account & Subscription */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(100)}
        >
          <ProfileSection title="Account & Subscription">
            <ProfileRow
              icon={CreditCard}
              sfIcon="creditcard.fill"
              iconColor={color.primary}
              title={isPro ? "Ekwe Pro" : "Plan & Billing"}
              subtitle={
                isPro ? "Unlimited translations" : "Free Tier · Standard limits"
              }
              onPress={async () => {
                triggerHaptic();
                router.push("/billing");
              }}
              trailing={
                isPro ? (
                  isIOS ? (
                    <ExpoImage
                      source="sf:chevron.right"
                      style={{ width: 14, height: 14 }}
                      tintColor={color.muted}
                    />
                  ) : (
                    <ChevronRight size={20} color={color.muted} />
                  )
                ) : (
                  <Box
                    style={[
                      styles.upgradeBadge,
                      { backgroundColor: color.secondary },
                    ]}
                  >
                    <Text
                      variant="caption"
                      style={{ color: color.onSecondary }}
                    >
                      Upgrade
                    </Text>
                  </Box>
                )
              }
            />
          </ProfileSection>
        </Animated.View>

        {/* App Preferences */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(150)}
        >
          <ProfileSection title="App Preferences">
            <ProfileRow
              icon={Globe}
              sfIcon="globe"
              iconColor={color.primary}
              title="Edit Language Grid"
              subtitle={`${selectedLanguages.length}/5 active languages`}
              hasDivider
              onPress={async () => {
                triggerHaptic();
                router.push("/edit-languages");
              }}
            />
            <ProfileRow
              icon={Smartphone}
              sfIcon="hand.tap.fill"
              iconColor={color.primary}
              title="Haptic Feedback"
              subtitle="Vibrate on user actions"
              onPress={async () => {
                await triggerHaptic();
                setHapticsEnabled(!hapticsEnabled);
              }}
              hasDivider
              trailing={
                <Switch
                  value={hapticsEnabled}
                  onValueChange={(val) => {
                    setHapticsEnabled(val);
                  }}
                  trackColor={{
                    true: color.primary,
                    false: color.border,
                  }}
                  thumbColor={color.card}
                />
              }
            />
            <ProfileRow
              icon={Globe}
              sfIcon="globe"
              iconColor={color.primary}
              title="Display Currency"
              subtitle="Choose your preferred currency"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                setIsCurrencyModalVisible(true);
              }}
              trailing={
                <Box style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    variant="body"
                    style={{ color: color.muted, marginRight: spacing.sm }}
                  >
                    {SUPPORTED_CURRENCIES.find((c) => c.code === currency)
                      ?.code || currency}
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </Box>
              }
            />
            <ProfileRow
              icon={Palette}
              sfIcon="paintpalette.fill"
              iconColor={color.primary}
              title="Appearance"
              subtitle="Light, Dark, or System"
              onPress={async () => {
                await triggerHaptic();
                setIsThemeModalVisible(true);
              }}
              trailing={
                <Box style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    variant="body"
                    style={{ color: color.muted, marginRight: spacing.sm }}
                  >
                    {colorScheme === "light"
                      ? "Light"
                      : colorScheme === "dark"
                        ? "Dark"
                        : "System"}
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </Box>
              }
            />
          </ProfileSection>
        </Animated.View>

        {/* Smart Features */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(200)}
        >
          <ProfileSection title="Smart Features">
            <ProfileRow
              icon={Copy}
              sfIcon="doc.on.doc.fill"
              iconColor={color.primary}
              title="Auto-copy to Clipboard"
              subtitle="Copy translation automatically"
              onPress={async () => {
                if (!isPro) {
                  AppAlert.info(
                    "Ekwe Pro Required",
                    "Auto-copy is a premium feature. Please upgrade to use this.",
                  );
                  router.push("/billing");
                  return;
                }
                if (permissions.autoCopy) {
                  await triggerHaptic();
                  setAutoCopy(!autoCopy);
                }
              }}
              hasDivider
              trailing={
                <Switch
                  value={permissions.autoCopy ? autoCopy : false}
                  onValueChange={(val) => {
                    setAutoCopy(val);
                  }}
                  trackColor={{
                    true: color.primary,
                    false: color.border,
                  }}
                  thumbColor={color.card}
                  disabled={!permissions.autoCopy}
                />
              }
            />
            <ProfileRow
              icon={Eye}
              sfIcon="eye.fill"
              iconColor={color.primary}
              title="Floating Translation Bubble"
              subtitle="Translate inline in external apps"
              onPress={async () => {
                if (permissions.contextAwareness) {
                  await triggerHaptic();
                  router.push("/accessibility-disclosure");
                }
              }}
              trailing={
                <Switch
                  value={!!hasPermission}
                  onValueChange={async (value) => {
                    if (value) {
                      router.push("/accessibility-disclosure");
                    }
                  }}
                  trackColor={{
                    true: color.primary,
                    false: color.border,
                  }}
                  thumbColor={color.card}
                  disabled={!permissions.contextAwareness}
                />
              }
            />
          </ProfileSection>
        </Animated.View>

        {/* Help & Legal */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(250)}
        >
          <ProfileSection title="Help & Legal">
            <ProfileRow
              icon={Mail}
              sfIcon="envelope.fill"
              iconColor={color.primary}
              title="Contact Support"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                Linking.openURL("mailto:emmanuelztrd@gmail.com");
              }}
            />
            <ProfileRow
              icon={Star}
              sfIcon="star.fill"
              iconColor={color.primary}
              title="Rate Us"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                let hasNativeAction = false;
                try {
                  hasNativeAction = await StoreReview.hasAction();
                } catch {
                  logger.warn(
                    "StoreReview native module not found, falling back to Linking",
                  );
                }

                if (hasNativeAction) {
                  try {
                    await StoreReview.requestReview();
                    return;
                  } catch {
                    logger.warn(
                      "StoreReview request failed, falling back to Linking",
                    );
                  }
                }

                // Fallback to deep link
                // Get from .env EXPO_PUBLIC_ITUNES_ITEM_ID
                const ITUNES_ITEM_ID =
                  process.env.EXPO_PUBLIC_ITUNES_ITEM_ID || "";
                if (!ITUNES_ITEM_ID || ITUNES_ITEM_ID === "123456789") {
                  logger.warn(
                    "[profile] ITUNES_ITEM_ID not set in .env - App Store review will fail",
                  );
                }
                const ANDROID_PACKAGE_NAME =
                  Constants.expoConfig?.android?.package ??
                  "com.anonymous.ekwe";

                if (!ITUNES_ITEM_ID) {
                  AppAlert.error(
                    "Error",
                    "iOS App Store ID not configured. Set EXPO_PUBLIC_ITUNES_ITEM_ID in .env",
                  );
                  return;
                }

                const url = isIOS
                  ? `itms-apps://itunes.apple.com/app/viewContentsUserReviews?id=${ITUNES_ITEM_ID}&action=write-review`
                  : `market://details?id=${ANDROID_PACKAGE_NAME}`;
                Linking.openURL(url).catch(() => {
                  AppAlert.error("Error", "Could not open the app store.");
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
                triggerHaptic();
                router.push("/legal/privacy");
              }}
            />
            <ProfileRow
              icon={FileText}
              sfIcon="doc.text.fill"
              iconColor={color.primary}
              title="Terms of Service"
              onPress={async () => {
                triggerHaptic();
                router.push("/legal/terms");
              }}
            />
          </ProfileSection>
        </Animated.View>

        {/* Account */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(300)}
        >
          <ProfileSection title="Account" titleColor={color.error}>
            <ProfileRow
              icon={LogOut}
              sfIcon="rectangle.portrait.and.arrow.right"
              iconColor={color.error}
              title="Log Out"
              subtitle="Sign out of your session"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
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
        </Animated.View>

        {/* Footer */}
        <Animated.View
          entering={FadeInDown.duration(duration.normal).delay(350)}
        >
          <Box style={styles.footer}>
            <Text
              variant="caption"
              style={{ opacity: opacity.inactive, color: color.muted }}
            >
              Made by the Ekwe team
            </Text>
            <Text
              variant="caption"
              style={{
                opacity: opacity.scrim,
                marginTop: spacing.xs,
                color: color.muted,
              }}
            >
              v{Constants.expoConfig?.version ?? "1.0.0"}
            </Text>
          </Box>
        </Animated.View>
      </ScrollArea>

      <AvatarPickerModal
        visible={isIconModalVisible}
        onClose={() => setIsIconModalVisible(false)}
        onSelect={handleUpdateIcon}
        currentIcon={user?.user_metadata?.avatar_icon}
      />

      <CurrencyPickerModal
        visible={isCurrencyModalVisible}
        onClose={() => setIsCurrencyModalVisible(false)}
        onSelect={async (code) => {
          await triggerHaptic();
          setCurrency(code);
          setIsCurrencyModalVisible(false);
        }}
        currentCurrency={currency}
      />

      <ThemePickerModal
        visible={isThemeModalVisible}
        onClose={() => setIsThemeModalVisible(false)}
        onSelect={async (value) => {
          await triggerHaptic();
          setColorScheme(value);
          setIsThemeModalVisible(false);
        }}
        currentTheme={colorScheme}
      />

      {/* ── Delete Account Confirmation Modal ── */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <Box
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color.overlay,
            paddingHorizontal: spacing.xl,
          }}
        >
          <Box
            style={{
              backgroundColor: color.surface,
              borderRadius: borderRadius["2xl"],
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: color.border,
              width: "100%",
              maxWidth: 400,
              gap: spacing.md,
            }}
          >
            <Text variant="heading3" style={{ textAlign: "center" }}>
              Delete Account
            </Text>
            <Text
              variant="body"
              style={{ textAlign: "center", color: color.muted }}
            >
              This will permanently delete your account and all associated data.
              This action cannot be undone.
            </Text>
            <Text
              variant="bodySmall"
              style={{ textAlign: "center", color: color.error }}
            >
              Type DELETE below to confirm.
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder='Type "DELETE"'
              placeholderTextColor={color.muted}
              autoCapitalize="characters"
              style={{
                borderWidth: 1,
                borderColor:
                  deleteConfirmText === "DELETE"
                    ? color.error
                    : color.border,
                borderRadius: borderRadius.xl,
                padding: spacing.md,
                color: color.foreground,
                fontSize: 16,
                textAlign: "center",
                fontWeight: "600",
              }}
            />
            <Box style={{ flexDirection: "row", gap: spacing.md }}>
              <Pressable
                onPress={() => setShowDeleteModal(false)}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: borderRadius.xl,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: color.border,
                }}
                feedback="none"
              >
                <Text variant="body" style={{ color: color.foreground }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmDeleteAccount}
                disabled={deleteConfirmText !== "DELETE"}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: borderRadius.xl,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: color.error,
                  opacity: deleteConfirmText === "DELETE" ? 1 : 0.4,
                }}
                feedback="none"
              >
                <Text
                  variant="body"
                  style={{ color: color.onPrimary, fontWeight: "600" }}
                >
                  Delete Permanently
                </Text>
              </Pressable>
            </Box>
          </Box>
        </Box>
      </Modal>
    </Box>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  upgradeBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  footer: {
    alignItems: "center" as const,
    paddingVertical: spacing.xl,
  },
};
