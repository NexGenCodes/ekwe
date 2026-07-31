package expo.modules.ekwenative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioPlaybackCaptureConfiguration
import android.util.Log

class AudioCaptureService : Service() {

    private var mediaProjection: MediaProjection? = null
    private var isRecording = false

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP = "ACTION_STOP"
        const val EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA"
        private const val NOTIFICATION_ID = 456
        private const val CHANNEL_ID = "AudioCaptureChannel"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
                val resultData = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
                startCapture(resultCode, resultData)
            }
            ACTION_STOP -> stopCapture()
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "System Audio Capture",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun startCapture(resultCode: Int, resultData: Intent?) {
        if (resultCode == 0 || resultData == null) {
            stopSelf()
            return
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Capturing internal audio")
            .setContentText("Ekwe is translating your audio")
            .setSmallIcon(android.R.drawable.ic_dialog_info) // Replace with your app icon
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, resultData)

        // The actual audio record instantiation logic
        // This is a placeholder for where the actual recording happens using AudioRecord
        // and AudioPlaybackCaptureConfiguration (API 29+)
        isRecording = true
        Log.d("AudioCaptureService", "MediaProjection started for loopback capture.")
        
        // TODO: Plumb AudioRecord data back to React Native Audio API
    }

    private fun stopCapture() {
        isRecording = false
        mediaProjection?.stop()
        mediaProjection = null
        Log.d("AudioCaptureService", "MediaProjection stopped.")
        stopForeground(true)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
