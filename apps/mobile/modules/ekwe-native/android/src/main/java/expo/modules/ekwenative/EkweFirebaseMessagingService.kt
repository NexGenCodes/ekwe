package expo.modules.ekwenative

import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Custom Firebase Messaging service that intercepts EKWE's `apk_update`
 * data-only messages before Expo sees them.
 *
 * The native path exists so an APK update can be shown and installed without
 * ever launching the JS app. Everything else (general pushes, future features)
 * is passed through to [ExpoFirebaseMessagingService], which keeps the normal
 * expo-notifications behavior intact.
 */
class EkweFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    if (data["type"] == "apk_update") {
      UpdateNotifier.handleApkUpdate(this, data)
    } else {
      super.onMessageReceived(message)
    }
  }
}
