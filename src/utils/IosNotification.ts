import * as Notifications from 'expo-notifications';
import { EkweError } from 'src/constants/errors';
import { Result, ok } from 'src/types/Result';

export const configureNotifications = (): void => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
};

export const requestNotificationPermission = async (): Promise<
  Result<boolean, EkweError>
> => {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return ok(status === 'granted');
  } catch {
    return ok(false);
  }
};

/**
 * Shows a rich notification after transcription completes on iOS.
 * Tapping the notification opens the app to the Result screen.
 */
export const showTranscriptNotification = async (
  transcript: string,
  sourceLang: string,
  sessionId: string,
): Promise<void> => {
  const preview =
    transcript.length > 80 ? transcript.substring(0, 80) + '…' : transcript;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Voice note from ${sourceLang.toUpperCase()}`,
      body: preview,
      data: { sessionId, action: 'view_transcript' },
      categoryIdentifier: 'transcript',
    },
    trigger: null, // show immediately
  });
};

/**
 * Registers notification categories with action buttons.
 * Call once on app start.
 */
export const registerNotificationCategories = async (): Promise<void> => {
  await Notifications.setNotificationCategoryAsync('transcript', [
    {
      identifier: 'copy',
      buttonTitle: 'Copy',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'translate',
      buttonTitle: 'Translate',
      options: { opensAppToForeground: true },
    },
  ]);
};
