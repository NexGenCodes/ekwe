package expo.modules.ekwenative

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import org.json.JSONObject

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
    var isApkUpdate = false
    var parsedData: Map<String, String>? = null

    // 1. Direct FCM payload (if sent directly bypassing Expo)
    if (data["type"] == "apk_update") {
      isApkUpdate = true
      parsedData = data
    } else {
      // 2. Expo Push API payload (Expo stringifies our payload into `body`)
      val bodyStr = data["body"]
      if (bodyStr != null) {
        try {
          val json = JSONObject(bodyStr)
          if (json.optString("type") == "apk_update") {
            isApkUpdate = true
            val map = mutableMapOf<String, String>()
            val keys = json.keys()
            while (keys.hasNext()) {
              val key = keys.next()
              map[key] = json.optString(key)
            }
            parsedData = map
          }
        } catch (e: Exception) {
          Log.w("EkweFCM", "Failed to parse body string as JSON", e)
        }
      }
    }

    if (isApkUpdate && parsedData != null) {
      UpdateNotifier.handleApkUpdate(this, parsedData)
    } else {
      super.onMessageReceived(message)
    }
  }
}
