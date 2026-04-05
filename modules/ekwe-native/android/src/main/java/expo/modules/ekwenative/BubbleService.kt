package expo.modules.ekwenative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class BubbleService : Service() {

  companion object {
    const val ACTION_START = "com.ekwe.BUBBLE_START"
    const val ACTION_STOP  = "com.ekwe.BUBBLE_STOP"
    const val CHANNEL_ID   = "ekwe_bubble"
    const val NOTIFICATION_ID = 1001
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(
    intent: Intent?,
    flags: Int,
    startId: Int
  ): Int {
    when (intent?.action) {
      ACTION_START -> startBubbleForeground()
      ACTION_STOP  -> stopSelf()
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startBubbleForeground() {
    // Open app intent for notification tap
    val openIntent = packageManager
      .getLaunchIntentForPackage(packageName)
    val pendingIntent = PendingIntent.getActivity(
      this, 0, openIntent,
      PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Ekwe is listening")
      .setContentText("Tap the bubble to translate a voice note")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setSilent(true)
      .build()

    // foregroundServiceType MICROPHONE — required Android 12+
    startForeground(
      NOTIFICATION_ID,
      notification,
      android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    )
  }

  private fun createNotificationChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ekwe Bubble",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Active while Ekwe bubble is visible"
      setShowBadge(false)
    }
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(channel)
  }
}
