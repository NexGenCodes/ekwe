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
import android.os.SystemClock
import android.util.Log
import expo.modules.ekwenative.PcmCaptureLoop
import java.io.File

class OrbCaptureService : Service() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var projection: MediaProjection? = null
  private var record: AudioRecord? = null
  private var loop: PcmCaptureLoop? = null
  private var appWatcher: OrbAppWatcher? = null
  private val vad = OrbVadGate(trailingMs = 1500L)
  private var streamClient: OrbStreamClient? = null
  private var streamEnabled = false
  private var lastVadActive: Boolean? = null
  private val finalTranscript = StringBuilder()
  private var streamFinalized = false
  private var finishing = false
  private var lastTranscriptAtMs = 0L
  private var hasAnyTranscript = false
  private var captureStartedAtMs = 0L

  private val vadCheckRunnable = object : Runnable {
    override fun run() {
      val currentLoop = loop ?: return
      if (!isRunning) return
      val amp = currentLoop.amplitude
      val db = if (amp > 0f) {
        (20 * Math.log10(amp.toDouble().coerceAtLeast(0.00001))).toFloat()
      } else {
        -100f
      }
      vad.onAmplitudeDb(db)
      lastPeakAmplitude = currentLoop.peakAmplitude

      val vadActive = db > -45f
      if (streamEnabled && vadActive != lastVadActive) {
        lastVadActive = vadActive
        streamClient?.sendVad(vadActive)
      }

      val overlay = runCatching { OrbOverlayManager.getInstance(this@OrbCaptureService) }.getOrNull()
      val now = System.currentTimeMillis()
      val silentLongEnough = now - captureStartedAtMs > 10_000 && db < -50f && lastPeakAmplitude < 0.01f
      val noTextYet = !hasAnyTranscript && overlay?.getLiveText().isNullOrBlank()
      if (streamEnabled) {
        overlay?.setSilenceSuspected(silentLongEnough && noTextYet)
        // Idle safeguard: if we've been streaming for a while with no speech/text
        // and near-silent audio, stop to avoid runaway sessions (server limits apply too).
        val idleTooLong = now - captureStartedAtMs > 90_000 && noTextYet && db < -50f
        val stalledAfterSpeech = hasAnyTranscript && lastTranscriptAtMs > 0L && now - lastTranscriptAtMs > 120_000 && db < -50f
        if (idleTooLong || stalledAfterSpeech) {
          Log.i(TAG, "Orb: streaming idle/silence safeguard triggered; stopping.")
          if (idleTooLong) {
            overlay?.setStreamState("error", "No capturable audio detected")
            overlay?.updateText("error")
          }
          finishCapture()
          return
        }
      }

      // In batch/file mode keep VAD auto-stop on trailing silence.
      if (!streamEnabled && vad.isSilencedForTooLong()) {
        Log.i(TAG, "Orb: VAD trailing silence reached; auto-stopping capture.")
        finishCapture()
        return
      }

      mainHandler.postDelayed(this, 100)
    }
  }

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      Log.w(TAG, "projection stopped")
      finishCapture()
    }
  }

  private fun stopInternal() {
    if (!isRunning && loop == null && record == null && projection == null) return

    mainHandler.removeCallbacks(vadCheckRunnable)
    appWatcher?.stop()
    appWatcher = null

    isRunning = false
    hasMediaProjection = false

    val overlay = runCatching { OrbOverlayManager.getInstance(this) }.getOrNull()
    overlay?.setRecording(false)
    if (!streamEnabled) overlay?.setStreaming(false)

    val active = loop
    active?.stop()
    if (active != null && active.peakAmplitude > lastPeakAmplitude) {
      lastPeakAmplitude = active.peakAmplitude
    }
    loop = null

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
      finishCapture()
      return START_NOT_STICKY
    }
    if (start.action == ACTION_STOP) {
      finishCapture()
      return START_NOT_STICKY
    }

    val resultCode = start.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
    val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      start.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      start.getParcelableExtra(EXTRA_RESULT_DATA)
    }
    if (resultCode == Int.MIN_VALUE || resultData == null) {
      Log.e(TAG, "no consent result")
      finishCapture()
      return START_NOT_STICKY
    }

    val projectionManager =
      getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val active = projectionManager.getMediaProjection(resultCode, resultData) ?: run {
      Log.e(TAG, "getMediaProjection returned null")
      finishCapture()
      return START_NOT_STICKY
    }
    projection = active
    hasMediaProjection = true
    active.registerCallback(projectionCallback, mainHandler)

    val created = buildRecord(active)
    if (created == null) {
      Log.e(TAG, "buildRecord returned null")
      finishCapture()
      return START_NOT_STICKY
    }

    val outputPath = start.getStringExtra(EXTRA_OUTPUT_PATH) ?: ""
    val isLive = start.getBooleanExtra(EXTRA_IS_LIVE, true)
    streamEnabled = start.getBooleanExtra(EXTRA_STREAM_ENABLED, false)
    val wsUrl = start.getStringExtra(EXTRA_STREAM_WS_URL)
    val token = start.getStringExtra(EXTRA_STREAM_TOKEN)
    val lang = start.getStringExtra(EXTRA_STREAM_LANG) ?: "en"

    val overlay = OrbOverlayManager.getInstance(this)
    overlay.resetSessionState()
    overlay.setDetectedLanguage(if (lang == "auto") null else lang)
    synchronized(finalTranscript) {
      finalTranscript.setLength(0)
    }
    streamFinalized = false
    finishing = false
    lastTranscriptAtMs = 0L
    hasAnyTranscript = false
    captureStartedAtMs = System.currentTimeMillis()

    if (streamEnabled && !wsUrl.isNullOrBlank()) {
      overlay.setStreaming(true)
      overlay.setRecording(true)
      overlay.setStreamState("connecting", null)
      streamClient = OrbStreamClient(
        wsUrl = wsUrl,
        token = token,
        lang = lang,
        onInterim = { text ->
          val t = text.trim()
          if (t.isNotEmpty()) {
            hasAnyTranscript = true
            lastTranscriptAtMs = System.currentTimeMillis()
          }
          overlay.setLiveInterim(t)
          if (t.isNotEmpty()) overlay.updateText("…")
        },
        onFinal = { text, language ->
          val t = text.trim()
          if (!language.isNullOrBlank()) overlay.setDetectedLanguage(language)
          if (t.isNotEmpty()) {
            hasAnyTranscript = true
            lastTranscriptAtMs = System.currentTimeMillis()
            synchronized(finalTranscript) {
              if (finalTranscript.isNotEmpty()) finalTranscript.append(" ")
              finalTranscript.append(t)
            }
            overlay.appendFinalTranscript(t, language)
            overlay.updateText("✓")
          }
        },
        onLanguageDetected = { language ->
          if (language.isNotBlank()) overlay.setDetectedLanguage(language)
        },
        onStatus = { msg ->
          if (msg.isNotBlank() && msg != "Listening…") {
            Log.d(TAG, "stream status: $msg")
          }
        },
        onState = { state, error ->
          overlay.setStreamState(state, error)
          if (state == "error" && !error.isNullOrBlank()) {
            overlay.updateText("error")
          }
        },
        onError = { msg ->
          Log.w(TAG, "stream error: $msg")
          overlay.setStreamState("error", msg)
          overlay.updateText("error")
        },
        onClose = { code, reason ->
          Log.i(TAG, "stream closed: $code $reason")
          if (isRunning && !finishing && code != 1000 && !hasAnyTranscript) {
            overlay.setStreamState("error", reason.ifBlank { "Stream disconnected" })
          }
          if (isRunning && !finishing) {
            streamFinalized = true
          }
        },
      )
      streamClient?.connect()
    } else {
      streamEnabled = false
      overlay.setStreaming(false)
      overlay.setStreamState("idle", null)
    }

    val captureLoop = PcmCaptureLoop(TAG)
    val pcmCallback: ((ShortArray, Int) -> Unit)? = if (streamEnabled) { samples, count ->
      streamClient?.sendPcm(samples, count)
    } else null

    if (!captureLoop.start(
        audioRecord = created,
        outputPath = outputPath,
        isLive = isLive,
        writeFile = !streamEnabled,
        onPcm16k = pcmCallback,
      )
    ) {
      Log.e(TAG, "loop start failed")
      runCatching { streamClient?.close(1011, "capture_start_failed") }
      streamClient = null
      streamEnabled = false
      overlay.setStreaming(false)
      overlay.setRecording(false)
      finishCapture()
      return START_NOT_STICKY
    }

    loop = captureLoop
    isRunning = true
    activeOutputPath = outputPath
    startedAtMs = System.currentTimeMillis()
    overlay.setRecording(true)

    appWatcher = OrbAppWatcher(this) { pkg, label ->
      currentForegroundApp = pkg
      currentForegroundAppLabel = label
      Log.d(TAG, "Foreground app: $pkg ($label)")
    }
    appWatcher?.start()

    vad.reset()
    mainHandler.post(vadCheckRunnable)

    return START_NOT_STICKY
  }

  private fun buildRecord(active: MediaProjection): AudioRecord? {
    val config = AudioPlaybackCaptureConfiguration.Builder(active)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
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
        NotificationChannel(CHANNEL_ID, "Orb transcription", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Transcribing app audio")
      .setContentText("Orb is listening to audio playing on your device")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun finishCapture() {
    if (finishing) return
    finishing = true

    val overlay = runCatching { OrbOverlayManager.getInstance(this) }.getOrNull()
    val wasStreaming = streamEnabled
    val path = activeOutputPath

    // Stop audio capture first so we stop sending PCM.
    stopInternal()

    if (wasStreaming) {
      val client = streamClient
      streamClient = null
      // Ask server to finalize; give it a brief window to emit trailing finals.
      runCatching { client?.requestStop() }
      SystemClock.sleep(350)
      runCatching { client?.close(1000, "done") }

      val finalText = synchronized(finalTranscript) { finalTranscript.toString().trim() }
      val bestText = when {
        finalText.isNotBlank() -> finalText
        !overlay?.getLiveText().isNullOrBlank() -> overlay!!.getLiveText().trim()
        else -> ""
      }

      if (!bestText.isNullOrBlank()) {
        overlay?.setResultText(bestText)
        if (overlay?.getLiveFinal().isNullOrBlank() && finalText.isBlank()) {
          // Keep interim-derived text visible if no explicit final arrived.
          overlay?.setLiveTranscript(bestText, "")
        }
        overlay?.updateText("✓")
      } else {
        if (overlay?.streamState != "error") {
          overlay?.setStreamState("error", "No transcript captured")
        }
        overlay?.updateText("error")
      }
      overlay?.setStreaming(false)
      if (overlay?.streamState == "listening" || overlay?.streamState == "connecting") {
        overlay?.setStreamState("idle", null)
      }
    } else {
      runCatching { streamClient?.close(1000, "done") }
      streamClient = null
      if (path.isNotBlank()) {
        val file = File(path)
        if (file.exists() && file.length() > 0) {
          runCatching {
            File(cacheDir, "ekwe_orb_pending.txt").writeText(path)
          }
        }
      }
      overlay?.setStreaming(false)
    }

    activeOutputPath = ""
    startedAtMs = 0L
    streamEnabled = false
    lastVadActive = null
    synchronized(finalTranscript) { finalTranscript.setLength(0) }

    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (!finishing) {
      finishCapture()
    } else {
      stopInternal()
    }
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
    const val EXTRA_STREAM_ENABLED = "streamEnabled"
    const val EXTRA_STREAM_WS_URL = "streamWsUrl"
    const val EXTRA_STREAM_TOKEN = "streamToken"
    const val EXTRA_STREAM_LANG = "streamLang"

    @Volatile
    var isRunning = false
      private set

    @Volatile
    var hasMediaProjection = false
      private set

    @Volatile
    var currentForegroundApp: String? = null
      private set

    @Volatile
    var currentForegroundAppLabel: String? = null
      private set

    @Volatile
    var lastPeakAmplitude = 0f
      private set

    @Volatile
    var activeOutputPath = ""
      private set

    @Volatile
    var startedAtMs = 0L
      private set
  }
}


