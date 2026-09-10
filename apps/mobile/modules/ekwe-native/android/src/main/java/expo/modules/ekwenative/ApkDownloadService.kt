package expo.modules.ekwenative

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Downloads the APK in a foreground service (progress in the tray) and then
 * fires the Android install prompt — the app never opens.
 *
 * The first time a user taps "Install", Android shows the "allow installs from
 * this source" gate. If that permission is missing the service posts a
 * notification that deep-links to the settings screen instead of silently
 * failing.
 */
class ApkDownloadService : Service() {
  private companion object {
    const val PROGRESS_ID = 1002
    const val CHUNK = 8 * 1024
    const val MAX_ATTEMPTS = 2
    private const val TAG = "ApkDownloadService"

    @Volatile
    var active = false
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val downloadUrl = intent?.getStringExtra("downloadUrl")
    val version = intent?.getStringExtra("version") ?: "latest"
    val checksum = intent?.getStringExtra("checksumSha256")

    if (downloadUrl == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    // Avoid a second download if the user taps the notification again mid-flight.
    if (active) return START_NOT_STICKY
    active = true

    Log.d(TAG, "Starting download of EKWE $version from $downloadUrl")

    // The "update available" notification served its purpose; the foreground
    // progress notification takes over from here.
    NotificationManagerCompat.from(this).cancel(UpdateNotifier.NOTIFICATION_ID)

    startForegroundCompat(PROGRESS_ID, progressNotification(version, 0, "Preparing…", true))
    thread { downloadAndInstall(downloadUrl, version, checksum) }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    active = false
    super.onDestroy()
  }

  private fun downloadAndInstall(url: String, version: String, checksum: String?) {
    try {
      val file = File(cacheDir, "ekwe-$version.apk")
      cleanupStaleApks(file)

      if (!attemptDownload(url, file, version)) {
        file.delete()
        showResultNotification("Download failed", "Could not download the update.")
        return
      }

      if (checksum != null && !verifyChecksum(file, checksum)) {
        Log.e(TAG, "Checksum mismatch for EKWE $version")
        file.delete()
        showResultNotification("Download failed", "The update could not be verified.")
        return
      }

      val contentUri = FileProvider.getUriForFile(
        this,
        "$packageName.fileprovider",
        file,
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      // Android 10+ blocks starting activities from the background.
      // If the download takes more than a few seconds, the exemption from the
      // notification click expires, and startActivity() is silently blocked.
      // The correct UX is to post a "Ready to install" notification.
      val pendingInstall = PendingIntent.getActivity(
        this,
        0,
        installIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val readyNotification = NotificationCompat.Builder(this, UpdateNotifier.CHANNEL_ID)
        .setSmallIcon(UpdateNotifier.notificationIcon(this))
        .setContentTitle("EKWE $version downloaded")
        .setContentText("Tap to install the update")
        .setContentIntent(pendingInstall)
        .setAutoCancel(true)
        .build()

      NotificationManagerCompat.from(this).notify(UpdateNotifier.NOTIFICATION_ID, readyNotification)
    } catch (e: Exception) {
      Log.e(TAG, "Update failed", e)
      showResultNotification("Download failed", "Could not download the update.")
    } finally {
      active = false
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  /**
   * Downloads [url] into [file] with one retry on transient errors. Returns
   * true only when a non-empty file was written; the partial file is always
   * deleted on a failed attempt.
   */
  private fun attemptDownload(url: String, file: File, version: String): Boolean {
    var attempt = 0
    while (attempt < MAX_ATTEMPTS) {
      attempt++
      try {
        file.delete()
        download(url, file, version)
        if (file.length() > 0L) return true
        Log.e(TAG, "Download produced an empty file (attempt $attempt/$MAX_ATTEMPTS)")
      } catch (e: Exception) {
        Log.e(TAG, "Download attempt $attempt/$MAX_ATTEMPTS failed", e)
        file.delete()
      }
    }
    return false
  }

  private fun download(url: String, target: File, version: String) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 30_000
      readTimeout = 30_000
      instanceFollowRedirects = true
    }
    try {
      val total = connection.contentLengthLong
      // GitHub release downloads sometimes omit Content-Length; fall back to an
      // indeterminate bar instead of showing a stuck 0% determinate bar.
      val indeterminate = total <= 0
      connection.inputStream.use { input ->
        FileOutputStream(target).use { output ->
          val buffer = ByteArray(CHUNK)
          var downloaded = 0L
          var lastReport = 0L
          while (true) {
            val read = input.read(buffer)
            if (read == -1) break
            output.write(buffer, 0, read)
            downloaded += read
            // Report progress ~every 256KB (and always at the end when the size is known).
            if (downloaded - lastReport >= 256 * 1024 || (total > 0 && downloaded >= total)) {
              lastReport = downloaded
              val percent = if (indeterminate) 0 else (downloaded * 100 / total).toInt()
              updateProgress(version, percent, indeterminate)
            }
          }
        }
      }
    } finally {
      connection.disconnect()
    }
  }

  /** Rejects a tampered/corrupt APK by comparing its SHA-256 to CI's checksum. */
  private fun verifyChecksum(file: File, expected: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read == -1) break
        digest.update(buffer, 0, read)
      }
    }
    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    return actual.equals(expected, ignoreCase = true)
  }

  /** Clears APKs left over from previous downloads so the cache never accumulates. */
  private fun cleanupStaleApks(current: File) {
    cacheDir.listFiles { f ->
      f.name.startsWith("ekwe-") && f.name.endsWith(".apk") && f != current
    }?.forEach { f ->
      if (!f.delete()) Log.w(TAG, "Could not delete stale APK ${f.name}")
    }
  }

  private fun startForegroundCompat(id: Int, notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(id, notification)
    }
  }


  private fun updateProgress(version: String, percent: Int, indeterminate: Boolean) {
    val notification = NotificationCompat.Builder(this, UpdateNotifier.CHANNEL_ID)
      .setSmallIcon(UpdateNotifier.notificationIcon(this))
      .setContentTitle("Downloading EKWE $version…")
      .setProgress(100, percent, indeterminate)
      .setOngoing(true)
      .build()
    NotificationManagerCompat.from(this).notify(PROGRESS_ID, notification)
  }

  private fun progressNotification(
    version: String,
    percent: Int,
    text: String,
    indeterminate: Boolean,
  ): Notification =
    NotificationCompat.Builder(this, UpdateNotifier.CHANNEL_ID)
      .setSmallIcon(UpdateNotifier.notificationIcon(this))
      .setContentTitle("Downloading EKWE $version…")
      .setContentText(text)
      .setProgress(100, percent, indeterminate)
      .setOngoing(true)
      .build()


  private fun showResultNotification(title: String, text: String) {
    val notification = NotificationCompat.Builder(this, UpdateNotifier.CHANNEL_ID)
      .setSmallIcon(UpdateNotifier.notificationIcon(this))
      .setContentTitle(title)
      .setContentText(text)
      .setAutoCancel(true)
      .build()
    NotificationManagerCompat.from(this).notify(PROGRESS_ID, notification)
  }


}
