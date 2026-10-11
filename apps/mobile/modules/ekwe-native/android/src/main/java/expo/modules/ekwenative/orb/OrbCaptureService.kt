package expo.modules.ekwenative.orb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import expo.modules.ekwenative.PcmCaptureLoop

class OrbCaptureService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var projection: MediaProjection? = null
  private var record: AudioRecord? = null
  private var loop: PcmCaptureLoop? = null

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      Log.w(TAG, "projection stopped")
      finish()
    }
  }

  fun stop() {
    val active = loop
    active?.stop()
    if (active != null && active.peakAmplitude > lastPeakAmplitude) {
      lastPeakAmplitude = active.peakAmplitude
    }
    loop = null
    runCatching { record?.stop() }
    runCatching { record?.release() }
    record = null
    runCatching { projection?.unregisterCallback(projectionCallback) }
    runCatching { projection?.stop() }
    projection = null
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForegroundWithNotification()

    val start = intent ?: run {
      finish()
      return START_NOT_STICKY
    }
    if (start.action == ACTION_STOP) {
      finish()
      return START_NOT_STICKY
    }

    val resultCode = start.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
    val resultData = start.getParcelableExtra(EXTRA_RESULT_DATA) as? Intent
    if (resultCode == Int.MIN_VALUE || resultData == null) {
      Log.e(TAG, "no consent result")
      finish()
      return START_NOT_STICKY
    }

    val projectionManager =
      getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val active = projectionManager.getMediaProjection(resultCode, resultData) ?: run {
      Log.e(TAG, "getMediaProjection returned null")
      finish()
      return START_NOT_STICKY
    }
    projection = active
    active.registerCallback(projectionCallback, mainHandler)

    val created = buildRecord(active)
    if (created == null) {
      Log.e(TAG, "buildRecord returned null")
      finish()
      return START_NOT_STICKY
    }

    val captureLoop = PcmCaptureLoop(TAG)
    val outputPath = start.getStringExtra(EXTRA_OUTPUT_PATH) ?: ""
    val isLive = start.getBooleanExtra(EXTRA_IS_LIVE, true)
    if (!captureLoop.start(created, outputPath, isLive)) {
      Log.e(TAG, "loop start failed")
      finish()
      return START_NOT_STICKY
    }
    loop = captureLoop
    return START_NOT_STICKY
  }

  private fun buildRecord(active: MediaProjection): AudioRecord? {
    val config = AudioPlaybackCaptureConfiguration.Builder(active)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .build()

    val format = AudioFormat.Builder()
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setSampleRate(REQUESTED_SAMPLE_RATE)
      .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
      .build()

    val minBuffer = AudioRecord.getMinBufferSize(
      REQUESTED_SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    if (minBuffer <= 0) {
      Log.e(TAG, "bad min buffer size $minBuffer")
      return null
    }

    val created = AudioRecord.Builder()
      .setAudioFormat(format)
      .setBufferSizeInBytes(minBuffer * 2)
      .setAudioPlaybackCaptureConfig(config)
      .build()

    if (created.state != AudioRecord.STATE_INITIALIZED) {
      Log.e(TAG, "AudioRecord not initialized")
      created.release()
      return null
    }

    record = created
    return created
  }

  private fun startForegroundWithNotification() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Voice note transcription", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Transcribing voice note")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun finish() {
    stop()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    stop()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "EkweOrb"
    private const val CHANNEL_ID = "orb_capture"
    private const val NOTIFICATION_ID = 0x0B
    private const val REQUESTED_SAMPLE_RATE = 48000

    const val ACTION_START = "expo.modules.ekwenative.orb.START"
    const val ACTION_STOP = "expo.modules.ekwenative.orb.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    const val EXTRA_OUTPUT_PATH = "outputPath"
    const val EXTRA_IS_LIVE = "isLive"

    @Volatile
    var lastPeakAmplitude = 0f
      private set
  }
}