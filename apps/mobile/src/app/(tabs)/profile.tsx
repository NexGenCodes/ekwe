import { useSelector } from "@legendapp/state/react";
import Constants from "expo-constants";
import { Image as ExpoImage } from "expo-image";
import { useRouter } from "expo-router";
import * as StoreReview from "expo-store-review";
import LogOut from "lucide-react-native/icons/log-out";
import CreditCard from "lucide-react-native/icons/credit-card";
import Trash2 from "lucide-react-native/icons/trash";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Mail from "lucide-react-native/icons/mail";
import Shield from "lucide-react-native/icons/shield";
import FileText from "lucide-react-native/icons/file-text";
import Star from "lucide-react-native/icons/star";
import Palette from "lucide-react-native/icons/palette";
import Copy from "lucide-react-native/icons/copy";
import Globe from "lucide-react-native/icons/globe";
import Smartphone from "lucide-react-native/icons/smartphone";
import Radio from "lucide-react-native/icons/radio";
import AudioLines from "lucide-react-native/icons/audio-lines";
import Banknote from "lucide-react-native/icons/banknote";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React, { useState, useCallback } from "react";
import { Linking, Modal, Switch, TextInput } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import {
  AvatarPickerModal,
  AVATAR_ICONS,
  ProfileRow,
  ProfileSection,
  ProfileIdentity,
  ThemePickerModal,
  VoicePickerModal,
  CurrencyPickerModal,
  QuotaUsageCard,
} from "@/components";
import { Box, Text, Pressable, ScrollArea } from "@/components/ui";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { duration, borderRadius, opacity, spacing } from "@/constants";
import { PLAN_LIMITS } from "@/constants/billing";
import { useLogout, useTheme, usePermissions, useReduceMotion } from "@/hooks";
import { useActivePricing } from "@/hooks/billing/useActivePricing";
import { deleteAccount } from "@/services/auth";
import {
  checkForApkUpdate,
  resolveApkDownloadUrl,
} from "@/services/otaUpdates";
import { SyncService } from "@/services/SyncService";
import { supabase } from "@/services/supabase";
import { auth$, authActions, settings$, settingsActions } from "@/store";
import { isIOS } from "@/utils";

import { AppAlert } from "@/utils/alert";
import { triggerHaptic } from "@/utils/haptics";
import logger from "@/utils/logger";
import { pushOnce } from "@/utils/navigation";

// ─── ProfileScreen ────────────────────────────────────────────────────────────

export default function ProfileScreen(): React.JSX.Element {
  const user = useSelector(() => auth$.user.get());
  const isPro = useSelector(() => auth$.isPro.get());
  const router = useRouter();
  const { color, colorScheme, setColorScheme } = useTheme();
  const permissions = usePermissions();
  const { confirmLogout } = useLogout();
  const reduceMotion = useReduceMotion();
  const sectionEnter = (
    delay: number,
  ): ReturnType<typeof FadeInDown.duration> | undefined =>
    reduceMotion
      ? undefined
      : FadeInDown.duration(duration.normal).delay(delay);

  const hapticsEnabled = useSelector(() => settings$.hapticsEnabled.get());
  const {
    setHapticsEnabled,
    setAutoCopy,
    setLiveTranscriptionEnabled,
    setTtsVoice,
    setCurrency,
  } = settingsActions;
  const selectedLanguages = useSelector(() =>
    settings$.selectedLanguages.get(),
  );
  const autoCopy = useSelector(() => settings$.autoCopy.get());
  const liveTranscriptionEnabled = useSelector(() =>
    settings$.liveTranscriptionEnabled.get(),
  );
  const ttsVoice = useSelector(() => settings$.ttsVoice.get());
  const currency = useSelector(() => settings$.currency.get());
  // Server-resolved currency: manual selection wins, otherwise the worker's
  // geo resolution (CF-IPCountry → billable set → USD). Users see the actual
  // currency they'll be billed in, never an opaque "Auto" placeholder.
  const { pricing } = useActivePricing();
  const effectiveCurrency = currency ?? pricing.currency;
  const currencyLabel = `${getCurrencySymbol(effectiveCurrency)} ${effectiveCurrency}`;

  const [isThemeModalVisible, setIsThemeModalVisible] = useState(false);
  const [isVoiceModalVisible, setIsVoiceModalVisible] = useState(false);
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
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
        <Animated.View entering={sectionEnter(0)}>
          <ProfileIdentity
            user={user}
            isPro={isPro}
            currentIconData={currentIconData}
            userName={userName}
            userEmail={userEmail}
            rawName={rawName}
            avatarLocked={!permissions.customAvatarIcons}
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
        <Animated.View entering={sectionEnter(100)}>
          <ProfileSection title="Account & Subscription">
            <ProfileRow
              icon={CreditCard}
              sfIcon="creditcard.fill"
              iconColor={color.foreground}
              title={isPro ? "Ekwe Pro" : "Plan & Billing"}
              subtitle={
                isPro
                  ? PLAN_LIMITS.pro.dailyTranslateLimit === 0
                    ? "Unlimited translations"
                    : `${PLAN_LIMITS.pro.dailyTranslateLimit.toLocaleString(
                        "en-US",
                      )} translations per day`
                  : "Free Tier · Standard limits"
              }
              onPress={async () => {
                await triggerHaptic();
                pushOnce(router, "/billing");
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
                      { backgroundColor: color.brand },
                    ]}
                  >
                    <Text variant="caption" style={{ color: color.onBrand }}>
                      Upgrade
                    </Text>
                  </Box>
                )
              }
            />
          </ProfileSection>
        </Animated.View>

        {/* Daily usage quota */}
        {!isPro && (
          <Animated.View
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.duration(duration.normal).delay(120)
            }
            style={{ marginBottom: spacing.xl }}
          >
            <QuotaUsageCard />
          </Animated.View>
        )}

        {/* App Preferences */}
        <Animated.View entering={sectionEnter(150)}>
          <ProfileSection title="App Preferences">
            <ProfileRow
              icon={Globe}
              sfIcon="globe"
              iconColor={color.foreground}
              title="Edit Language Grid"
              subtitle={`${selectedLanguages.length}/5 active languages`}
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                pushOnce(router, "/edit-languages");
              }}
            />
            <ProfileRow
              icon={Banknote}
              sfIcon="dollarsign.circle.fill"
              iconColor={color.foreground}
              title="Currency"
              subtitle="Payment currency for subscriptions"
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
                    {currencyLabel}
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </Box>
              }
            />
            <ProfileRow
              icon={Smartphone}
              sfIcon="hand.tap.fill"
              iconColor={color.foreground}
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
                    true: color.foreground,
                    false: color.border,
                  }}
                  thumbColor={color.card}
                />
              }
            />
            <ProfileRow
              icon={Palette}
              sfIcon="paintpalette.fill"
              iconColor={color.foreground}
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
        <Animated.View entering={sectionEnter(200)}>
          <ProfileSection title="Smart Features">
            <ProfileRow
              icon={Radio}
              sfIcon="waveform"
              iconColor={color.foreground}
              title="Live Transcription"
              subtitle="See transcription appear in real time during recording"
              locked={!isPro}
              onPress={async () => {
                if (!isPro) {
                  await triggerHaptic();
                  AppAlert.info(
                    "Ekwe Pro Required",
                    "Live Transcription is a premium feature. Upgrade to Pro to enable it.",
                  );
                  return;
                }
                await triggerHaptic();
                setLiveTranscriptionEnabled(!liveTranscriptionEnabled);
              }}
              hasDivider
              trailing={
                isPro ? (
                  <Switch
                    value={liveTranscriptionEnabled}
                    onValueChange={(val) => {
                      setLiveTranscriptionEnabled(val);
                    }}
                    trackColor={{
                      true: color.foreground,
                      false: color.border,
                    }}
                    thumbColor={color.card}
                  />
                ) : undefined
              }
            />
            <ProfileRow
              icon={AudioLines}
              sfIcon="speaker.wave.2.fill"
              iconColor={color.foreground}
              title="Voice"
              subtitle="Applied to spoken translations; the device uses the closest matching installed voice"
              hasDivider
              locked={!isPro}
              onPress={async () => {
                if (!isPro) {
                  await triggerHaptic();
                  AppAlert.info(
                    "Ekwe Pro Required",
                    "Voice selection is a premium feature. Upgrade to Pro to choose a voice.",
                  );
                  return;
                }
                await triggerHaptic();
                setIsVoiceModalVisible(true);
              }}
              trailing={
                <Box style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    variant="body"
                    style={{ color: color.muted, marginRight: spacing.sm }}
                  >
                    {ttsVoice === "male"
                      ? "Male"
                      : ttsVoice === "female"
                        ? "Female"
                        : "Default"}
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </Box>
              }
            />
            <ProfileRow
              icon={Copy}
              sfIcon="doc.on.doc.fill"
              iconColor={color.foreground}
              title="Auto-copy to Clipboard"
              subtitle="Copy translation automatically"
              onPress={async () => {
                await triggerHaptic();
                setAutoCopy(!autoCopy);
              }}
              hasDivider
              trailing={
                <Switch
                  value={autoCopy}
                  onValueChange={(val) => {
                    setAutoCopy(val);
                  }}
                  trackColor={{
                    true: color.foreground,
                    false: color.border,
                  }}
                  thumbColor={color.card}
                />
              }
            />
          </ProfileSection>
        </Animated.View>

        {/* Help & Legal */}
        <Animated.View entering={sectionEnter(250)}>
          <ProfileSection title="Help & Legal">
            <ProfileRow
              icon={Mail}
              sfIcon="envelope.fill"
              iconColor={color.foreground}
              title="Contact Support"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                Linking.openURL("mailto:emmanuelztrd@gmail.com");
              }}
            />
            <ProfileRow
              icon={RefreshCw}
              sfIcon="arrow.triangle.2.circlepath"
              iconColor={color.foreground}
              title="Check for update"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                const manifest = await checkForApkUpdate();
                if (manifest) {
                  AppAlert.info(
                    "Update available",
                    `Version ${manifest.latest_version} is available.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Download",
                        onPress: (): void => {
                          Linking.openURL(resolveApkDownloadUrl(manifest));
                        },
                      },
                    ],
                  );
                } else {
                  AppAlert.info(
                    "Up to date",
                    "You're running the latest version.",
                  );
                }
              }}
            />
            <ProfileRow
              icon={Star}
              sfIcon="star.fill"
              iconColor={color.foreground}
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
              iconColor={color.foreground}
              title="Privacy Policy"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                pushOnce(router, "/legal/privacy");
              }}
            />
            <ProfileRow
              icon={FileText}
              sfIcon="doc.text.fill"
              iconColor={color.foreground}
              title="Terms of Service"
              onPress={async () => {
                await triggerHaptic();
                pushOnce(router, "/legal/terms");
              }}
            />
          </ProfileSection>
        </Animated.View>

        {/* Account */}
        <Animated.View entering={sectionEnter(300)}>
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

        {/* Data */}
        <Animated.View entering={sectionEnter(350)}>
          <ProfileSection title="Data">
            <ProfileRow
              icon={Trash2}
              sfIcon="trash.fill"
              iconColor={color.error}
              title="Clear History"
              subtitle="Delete all transcripts and translations"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                const userId = user?.id;
                if (!userId) return;
                AppAlert.confirm(
                  "Clear All History",
                  "This will permanently delete all your transcripts and translations from this device and the cloud. This action cannot be undone.",
                  async () => {
                    await triggerHaptic();
                    await SyncService.clearAllHistory(userId);
                    AppAlert.success("All history cleared");
                  },
                  {
                    isDestructive: true,
                    confirmText: "Clear All",
                    cancelText: "Cancel",
                  },
                );
              }}
              trailing={null}
            />
          </ProfileSection>
        </Animated.View>

        {/* Footer */}
        <Animated.View entering={sectionEnter(400)}>
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

      <VoicePickerModal
        visible={isVoiceModalVisible}
        onClose={() => setIsVoiceModalVisible(false)}
        onSelect={async (value) => {
          await triggerHaptic();
          setTtsVoice(value);
          setIsVoiceModalVisible(false);
        }}
        currentVoice={ttsVoice}
        isPro={isPro}
      />

      <CurrencyPickerModal
        visible={isCurrencyModalVisible}
        onClose={() => setIsCurrencyModalVisible(false)}
        onSelect={async (value) => {
          await triggerHaptic();
          setCurrency(value);
          setIsCurrencyModalVisible(false);
        }}
        currentCurrency={currency}
        resolvedCurrency={effectiveCurrency}
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
                  deleteConfirmText === "DELETE" ? color.error : color.border,
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
                  minHeight: 48,
                  paddingVertical: spacing.xs,
                  borderRadius: borderRadius.xl,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: color.border,
                }}
                feedback="none"
              >
                <Text
                  variant="body"
                  style={{ color: color.foreground, textAlign: "center" }}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={confirmDeleteAccount}
                disabled={deleteConfirmText !== "DELETE"}
                style={{
                  flex: 1,
                  minHeight: 48,
                  paddingVertical: spacing.xs,
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
                  style={{
                    color: color.onBrand,
                    fontWeight: "600",
                    textAlign: "center",
                  }}
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
    marginLeft: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  footer: {
    alignItems: "center" as const,
    paddingVertical: spacing.xl,
  },
};
// test
