package expo.modules.ekwenative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * Handles `apk_update` data-only push messages: decides whether the user should
 * see an update notification (never notify users already on the incoming
 * version) and fires the native download+install flow via [ApkDownloadService].
 */
object UpdateNotifier {
  const val CHANNEL_ID = "apk-updates"
  const val NOTIFICATION_ID = 1001
  private const val TAG = "UpdateNotifier"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "EKWE app update notifications" },
        )
      }
    }
  }

  fun handleApkUpdate(context: Context, data: Map<String, String>) {
    val version = data["version"]?.takeIf { it.isNotBlank() } ?: return
    val versionCode = data["versionCode"]?.toIntOrNull()

    // Resolve download URL — prefer per-ABI map, fall back to single URL
    val downloadUrl = resolveAbiUrl(data) ?: return
    val checksum = resolveAbiChecksum(data)

    // Never notify users who are already on this version or newer. Prefer the
    // numeric versionCode (catches native-only rebuilds that don't bump the
    // versionName) and fall back to the versionName comparison for pushes
    // that don't carry a versionCode.
    if (versionCode != null) {
      if (versionCode <= currentVersionCode(context)) {
        Log.d(TAG, "Skipping $version: installed versionCode >= $versionCode")
        return
      }
    } else {
      val installed = currentVersionName(context) ?: return
      if (compareVersions(installed, version) >= 0) return
    }

    ensureChannel(context)

    val serviceIntent = Intent(context, ApkDownloadService::class.java).apply {
      putExtra("downloadUrl", downloadUrl)
      putExtra("version", version)
      if (versionCode != null) putExtra("versionCode", versionCode)
      if (checksum != null) putExtra("checksumSha256", checksum)
    }
    val pendingIntent = PendingIntent.getService(
      context,
      0,
      serviceIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    Log.d(TAG, "Notifying user about EKWE $version (ABI: ${deviceAbi()}, URL: $downloadUrl)")

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(notificationIcon(context))
      .setContentTitle("EKWE update available")
      .setContentText("Version $version is ready — tap to install")
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .build()

    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  /** Primary ABI of this device (e.g. "arm64-v8a", "armeabi-v7a"). */
  private fun deviceAbi(): String = Build.SUPPORTED_ABIS.firstOrNull() ?: "armeabi-v7a"

  /**
   * Pick the right download URL for this device's ABI.
   * Checks the per-ABI `downloadUrls` map first; falls back to the legacy
   * `downloadUrl` field (armv7, works on both archs).
   */
  private fun resolveAbiUrl(data: Map<String, String>): String? {
    val urlsJson = data["downloadUrls"]?.takeIf { it.isNotBlank() }
    if (urlsJson != null) {
      try {
        val urls = JSONObject(urlsJson)
        val abi = deviceAbi()
        // Exact match first (arm64-v8a on arm64 device)
        if (urls.has(abi)) return urls.getString(abi)
        // Fallback: arm64 devices can run armv7
        if (urls.has("armeabi-v7a")) return urls.getString("armeabi-v7a")
      } catch (e: Exception) {
        Log.w(TAG, "Failed to parse downloadUrls JSON, falling back to downloadUrl", e)
      }
    }
    // Legacy single-URL format (old server / backward compat)
    return data["downloadUrl"]?.takeIf { it.isNotBlank() }
  }

  /**
   * Pick the matching checksum for the resolved ABI.
   * Falls back to the legacy `checksumSha256` field.
   */
  private fun resolveAbiChecksum(data: Map<String, String>): String? {
    val checksumsJson = data["checksums"]?.takeIf { it.isNotBlank() }
    if (checksumsJson != null) {
      try {
        val checksums = JSONObject(checksumsJson)
        val abi = deviceAbi()
        if (checksums.has(abi)) return checksums.getString(abi)
        if (checksums.has("armeabi-v7a")) return checksums.getString("armeabi-v7a")
      } catch (e: Exception) {
        Log.w(TAG, "Failed to parse checksums JSON, falling back to checksumSha256", e)
      }
    }
    return data["checksumSha256"]?.takeIf { it.isNotBlank() }
  }

  /**
   * The notification icon is generated into the *app* module by the
   * expo-notifications config plugin, so it is resolved at runtime rather than
   * compiled against.
   */
  fun notificationIcon(context: Context): Int {
    val id = context.resources.getIdentifier(
      "notification_icon",
      "drawable",
      context.packageName,
    )
    return if (id != 0) id else android.R.drawable.ic_dialog_info
  }

  private fun currentVersionName(context: Context): String? = try {
    context.packageManager.getPackageInfo(context.packageName, 0).versionName
  } catch (e: PackageManager.NameNotFoundException) {
    null
  }

  private fun currentVersionCode(context: Context): Long {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
  }

  /** Compare dotted numeric versions ("1.10.0" > "1.9.0"). Returns a-b semantics. */
  fun compareVersions(a: String, b: String): Int {
    val pa = a.trim().split('.')
    val pb = b.trim().split('.')
    for (i in 0 until maxOf(pa.size, pb.size)) {
      val va = pa.getOrNull(i)?.toIntOrNull() ?: 0
      val vb = pb.getOrNull(i)?.toIntOrNull() ?: 0
      if (va != vb) return va - vb
    }
    return 0
  }
}
