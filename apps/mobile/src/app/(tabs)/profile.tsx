import { useValue } from "@legendapp/state/react";
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
import CircleDot from "lucide-react-native/icons/circle-dot";
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
  VoicePickerSheet,
  CurrencyPickerModal,
  QuotaUsageCard,
} from "@/components";
import { useTabBarTotalHeight } from "@/components/CustomTabBar";
import { Box, Text, Pressable, ScrollArea, Spinner } from "@/components/ui";
import { APP_VERSION, type VoiceGender } from "@ekwe/shared";
import { getCurrencySymbol } from "@ekwe/shared/money";
import { duration, borderRadius, spacing } from "@/constants";
import { PLAN_LIMITS } from "@/constants/billing";
import { EkweError, ErrorMessages } from "@/constants/errors";
import { useLogout, useTheme, usePermissions, useReduceMotion } from "@/hooks";
import { deleteAccount } from "@/services/auth";
import {
  checkForApkUpdate,
  resolveApkDownloadUrl,
} from "@/services/otaUpdates";
import { SyncService } from "@/services/syncService";
import { supabase } from "@/services/supabase";
import {
  auth$,
  authActions,
  settings$,
  settingsActions,
  update$,
} from "@/store";
import { AppAlert, isIOS } from "@/utils";

import { resolveVoiceSelection, type VoiceSelection } from "@/utils/voices";

import { useVoicePreview } from "@/hooks/audio/useVoicePreview";
import { useSessionAudioFiles } from "@/utils/sessionAudioFiles";
import { AppToast } from "@/utils/toast";
import { AnalyticsEvents, track } from "@/utils/analytics";
import { triggerHaptic } from "@/utils/haptics";
import logger from "@/utils/logger";
import { pushOnce } from "@/utils/navigation";

export default function ProfileScreen(): React.JSX.Element {
  const user = useValue(() => auth$.user.get());
  const isPro = useValue(() => auth$.isPro.get());
  const router = useRouter();
  const { color, colorScheme, setColorScheme } = useTheme();
  const tabBarHeight = useTabBarTotalHeight();
  const permissions = usePermissions();
  const { confirmLogout } = useLogout();
  const reduceMotion = useReduceMotion();
  const sectionEnter = (
    delay: number,
  ): ReturnType<typeof FadeInDown.duration> | undefined =>
    reduceMotion
      ? undefined
      : FadeInDown.duration(duration.normal).delay(delay);

  const hapticsEnabled = useValue(() => settings$.hapticsEnabled.get());
  const {
    setHapticsEnabled,
    setAutoCopy,
    setOrbEnabled,
    setVoiceGender,
    setVoiceId,
    setCurrency,
  } = settingsActions;
  const selectedLanguages = useValue(() => settings$.selectedLanguages.get());
  const autoCopy = useValue(() => settings$.autoCopy.get());
  const orbEnabled = useValue(() => settings$.orbEnabled.get());
  const voiceGender = useValue(() => settings$.voiceGender.get());
  const voiceId = useValue(() => settings$.voiceId.get());
  const activeVoice = resolveVoiceSelection(voiceId, voiceGender);
  const currency = useValue(() => settings$.currency.get());
  const currencyLabel = `${getCurrencySymbol(currency)} ${currency}`;

  const [isThemeModalVisible, setIsThemeModalVisible] = useState(false);
  const [isVoiceModalVisible, setIsVoiceModalVisible] = useState(false);
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const availableUpdate = useValue(() =>
    update$.channel.get() === "apk-sideload" ? update$.manifest.get() : null,
  );
  const currentVersion =
    APP_VERSION || Constants.expoConfig?.version || "1.0.0";

  const handleCheckForUpdate = useCallback(async (): Promise<void> => {
    if (isCheckingUpdate) return;
    await triggerHaptic();
    setIsCheckingUpdate(true);
    try {
      const manifest = await checkForApkUpdate();
      update$.manifest.set(manifest);
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
        AppAlert.info("Up to date", "You're running the latest version.");
      }
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [isCheckingUpdate]);

  const rawName =
    user?.user_metadata?.full_name || user?.user_metadata?.name || "";
  const userEmail = user?.email || "";

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
    await triggerHaptic();
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

  const previewLang = selectedLanguages[0] ?? "en";

  const files = useSessionAudioFiles();
  const handlePreviewError = useCallback((error: EkweError): void => {
    AppToast.error("Preview Unavailable", {
      description: ErrorMessages[error],
    });
  }, []);
  const preview = useVoicePreview({
    lang: previewLang,
    files,
    onError: handlePreviewError,
  });

  const handlePreviewVoice = useCallback(
    async (previewed: VoiceSelection): Promise<void> => {
      await triggerHaptic();
      preview.preview(previewed);
    },
    [preview],
  );

  const handleVoiceGenderChange = useCallback(
    (gender: VoiceGender): void => {
      // Drop anything sounding first, so a preview of the gender being left
      // cannot begin playing under the one just selected.
      preview.cancel();
      setVoiceGender(gender);
    },
    [preview, setVoiceGender],
  );

  return (
    <Box style={[styles.flex1, { backgroundColor: color.background }]}>
      <ScrollArea
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: tabBarHeight + spacing.xl,
        }}
      >
        {}
        <Animated.View entering={sectionEnter(0)}>
          <ProfileIdentity
            user={user!}
            isPro={isPro}
            currentIconData={currentIconData}
            userName={userName}
            userEmail={userEmail}
            rawName={rawName}
            avatarLocked={!permissions.customAvatarIcons}
            onEditAvatar={async () => {
              await triggerHaptic();
              setIsIconModalVisible(true);
            }}
          />
        </Animated.View>

        {}
        <Animated.View entering={sectionEnter(80)}>
          <ProfileSection
            title="Account & Subscription"
            tierBar={isPro ? "pro" : "free"}
          >
            <ProfileRow
              icon={CreditCard}
              sfIcon="creditcard.fill"
              iconColor={isPro ? color.brand : color.foreground}
              title={isPro ? "Ekwe Pro" : "Plan & Billing"}
              subtitle={
                isPro
                  ? PLAN_LIMITS.pro.dailyTranslateLimit === 0
                    ? "Unlimited translations · Premium voices"
                    : `${PLAN_LIMITS.pro.dailyTranslateLimit.toLocaleString(
                        "en-US",
                      )} translations per day`
                  : "Free Tier · Standard limits"
              }
              onPress={async () => {
                await triggerHaptic();
                pushOnce(router, "/billing");
              }}
              accentColor={isPro ? color.brand : undefined}
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

        {}
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

        {}
        <Animated.View entering={sectionEnter(120)}>
          <ProfileSection title="App Preferences">
            <ProfileRow
              icon={Globe}
              sfIcon="globe"
              iconColor={color.foreground}
              title="Edit Language Grid"
              subtitle={`${selectedLanguages.length}/${permissions.maxSelectedLanguages} active languages`}
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
              subtitle="Currency used for subscription prices and checkout"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                setIsCurrencyModalVisible(true);
              }}
              trailing={
                <Box style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    variant="body"
                    numberOfLines={1}
                    style={{
                      color: color.muted,
                      marginRight: spacing.sm,
                      flexShrink: 1,
                    }}
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
              checked={hapticsEnabled}
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                setHapticsEnabled(!hapticsEnabled);
              }}
              trailing={
                <Switch
                  value={hapticsEnabled}
                  onValueChange={(val) => {
                    setHapticsEnabled(val);
                  }}
                  trackColor={{
                    true: color.brand,
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
                    numberOfLines={1}
                    style={{
                      color: color.muted,
                      marginRight: spacing.sm,
                      flexShrink: 1,
                    }}
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

        {}
        <Animated.View entering={sectionEnter(160)}>
          <ProfileSection
            title="Smart Features"
            tierBar={isPro ? "pro" : "free"}
          >
            <ProfileRow
              icon={CircleDot}
              sfIcon="circle.dotted"
              iconColor={color.foreground}
              title="Orb"
              subtitle="Transcribe while playing in another app"
              checked={isPro ? orbEnabled : undefined}
              locked={!isPro}
              navigateToBilling
              onPress={async () => {
                if (isPro) {
                  await triggerHaptic();
                  setOrbEnabled(!orbEnabled);
                }
              }}
              trailing={
                isPro ? (
                  <Switch
                    value={orbEnabled}
                    onValueChange={(val) => {
                      setOrbEnabled(val);
                    }}
                    trackColor={{
                      true: color.brand,
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
              subtitle="Your default voice for voice notes"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                setIsVoiceModalVisible(true);
              }}
              trailing={
                <Box style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text
                    variant="body"
                    numberOfLines={1}
                    style={{
                      color: color.muted,
                      marginRight: spacing.sm,
                      flexShrink: 1,
                    }}
                  >
                    {activeVoice.slot.name}
                  </Text>
                  <ChevronRight size={16} color={color.muted} />
                </Box>
              }
            />
            <ProfileRow
              icon={Copy}
              sfIcon="doc.on.doc.fill"
              iconColor={color.foreground}
              title="Auto-copy"
              subtitle="Copy translation automatically"
              checked={isPro ? autoCopy : undefined}
              locked={!isPro}
              navigateToBilling
              onPress={async () => {
                if (!isPro) return;
                await triggerHaptic();
                setAutoCopy(!autoCopy);
              }}
              trailing={
                isPro ? (
                  // Indicator only — the row above is the toggle. A live Switch
                  // here also fired the row press, toggling twice.
                  <Box pointerEvents="none">
                    <Switch
                      value={autoCopy}
                      trackColor={{
                        true: color.brand,
                        false: color.border,
                      }}
                      thumbColor={color.card}
                    />
                  </Box>
                ) : undefined
              }
            />
          </ProfileSection>
        </Animated.View>

        {}
        <Animated.View entering={sectionEnter(200)}>
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
              title="Check for Updates"
              subtitle={
                availableUpdate
                  ? `Current version ${currentVersion} · ${availableUpdate.latest_version} available`
                  : `Current version ${currentVersion}`
              }
              hasDivider
              onPress={handleCheckForUpdate}
              trailing={
                isCheckingUpdate ? (
                  <Spinner size="sm" color={color.muted} />
                ) : availableUpdate ? (
                  <Box
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                    }}
                  >
                    <Box
                      style={[
                        styles.updateBadge,
                        { backgroundColor: color.brand },
                      ]}
                    >
                      <Text variant="caption" style={{ color: color.onBrand }}>
                        New
                      </Text>
                    </Box>
                    <ChevronRight size={20} color={color.muted} />
                  </Box>
                ) : undefined
              }
            />
            <ProfileRow
              icon={Star}
              sfIcon="star.fill"
              iconColor={color.foreground}
              title="Rate Us"
              hasDivider
              onPress={async () => {
                await triggerHaptic();
                track(AnalyticsEvents.RATE_PROMPT_SHOWN);
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
                    track(AnalyticsEvents.RATE_PROMPT_RATED, {
                      method: "native",
                    });
                    return;
                  } catch {
                    logger.warn(
                      "StoreReview request failed, falling back to Linking",
                    );
                  }
                }

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
                Linking.openURL(url)
                  .then(() => {
                    track(AnalyticsEvents.RATE_PROMPT_RATED, {
                      method: "store_link",
                    });
                  })
                  .catch(() => {
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

        {}
        <Animated.View entering={sectionEnter(240)}>
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

        {}
        <Animated.View entering={sectionEnter(280)}>
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

        {}
        <Animated.View entering={sectionEnter(320)}>
          <Box style={styles.footer}>
            <Text variant="caption" style={{ color: color.muted }}>
              Made by the Ekwe team
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

      <VoicePickerSheet
        visible={isVoiceModalVisible}
        onClose={() => {
          preview.reset();
          setIsVoiceModalVisible(false);
        }}
        title="Default Voice"
        currentVoiceId={activeVoice.slot.id}
        currentGender={activeVoice.gender}
        onGenderChange={handleVoiceGenderChange}
        onSelect={async (selection) => {
          await triggerHaptic();
          setVoiceId(selection.slot.id);
          setVoiceGender(selection.gender);
          preview.reset();
          setIsVoiceModalVisible(false);
        }}
        onPreview={handlePreviewVoice}
        activePreviewKey={preview.activeKey}
        previewPhase={preview.phase}
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
      />

      {}
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
                accessibilityRole="button"
                accessibilityLabel="Cancel account deletion"
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
                accessibilityRole="button"
                accessibilityLabel="Delete account permanently"
                accessibilityState={{
                  disabled: deleteConfirmText !== "DELETE",
                }}
                accessibilityHint={
                  deleteConfirmText === "DELETE"
                    ? "Permanently deletes your account"
                    : "Type DELETE above to enable this button"
                }
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

const styles = {
  flex1: { flex: 1 },
  scrollView: { flex: 1 },
  upgradeBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  updateBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  footer: {
    alignItems: "center" as const,
    paddingVertical: spacing.xl,
  },
};
