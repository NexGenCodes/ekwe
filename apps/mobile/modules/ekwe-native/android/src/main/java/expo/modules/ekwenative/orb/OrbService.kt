package expo.modules.ekwenative.orb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import expo.modules.ekwenative.PcmCaptureLoop

class OrbService : Service() {
  companion object {
    const val CHANNEL_ID = "orb_channel"
    const val NOTIF_ID = 2001
    const val ACTION_START = "expo.modules.ekwenative.orb.ACTION_START"
    const val ACTION_STOP = "expo.modules.ekwenative.orb.ACTION_STOP"
    const val EXTRA_PROJECTION_DATA = "projection_data"
    const val EXTRA_RESULT_CODE = "result_code"
  }

  inner class LocalBinder : Binder() {
    fun getService(): OrbService = this@OrbService
  }
  private val binder = LocalBinder()
  private var overlay: OrbOverlayManager? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
  }

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        overlay = OrbOverlayManager.getInstance(this)
        overlay?.showBubble()
      }
      ACTION_STOP -> stopCapture()
    }
    startForeground(NOTIF_ID, buildNotif())
    return START_STICKY
  }

  private fun createChannel() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val ch = NotificationChannel(CHANNEL_ID, "Orb", NotificationManager.IMPORTANCE_LOW)
    nm.createNotificationChannel(ch)
  }

  private fun buildNotif(): Notification {
    val icon = android.R.drawable.ic_btn_speak_now
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Orb")
      .setContentText("Listening")
      .setSmallIcon(icon)
      .build()
  }

  private fun stopCapture() {
    overlay?.hide()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stopCapture()
    super.onDestroy()
  }
}
