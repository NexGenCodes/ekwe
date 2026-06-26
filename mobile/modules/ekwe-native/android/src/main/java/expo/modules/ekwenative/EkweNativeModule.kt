package expo.modules.ekwenative

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  // AudioRecord capture state
  private var audioRecord: AudioRecord? = null
  private var isAudioRecording = false
  private var recordingThread: Thread? = null
  @Volatile
  private var currentAmplitude: Float = 0f

  companion object {
    var instance: EkweNativeModule? = null

    init {
      System.loadLibrary("ekwe_native_jni")
    }
    var isAppBackgrounded: Boolean = true

    fun emitStateChanged(state: String, previousState: String, reason: String) {
      instance?.let { module ->
        try {
          module.sendEvent("onStateChanged", mapOf(
            "state" to state,
            "previousState" to previousState,
            "reason" to reason
          ))
        } catch (e: Exception) {
          Log.w("EkweNative", "Failed to emit state changed event: $state", e)
        }
      }
    }

    fun emitIntentQueued(audioPath: String, sourceApp: String) {
      instance?.let { module ->
        module.sendEvent("onIntentQueued", mapOf(
          "audioPath" to audioPath,
          "sourceApp" to sourceApp
        ))
      }
    }

    // --- Native Audio Processing (JNI) ---
    @JvmStatic external fun extractWavAndWaveformJNI(inputPath: String, outputPath: String): Array<Any?>
    @JvmStatic external fun encodePcmToFlacJNI(pcmData: ShortArray, sampleRate: Int, channels: Int, outputPath: String): Array<Any?>

    // New: memory-based decode (no temp file for content:// → FLAC)
    @JvmStatic external fun extractFromMemoryJNI(data: ByteArray, outputPath: String): Array<Any?>

    // New: streaming FLAC encoder for AudioRecord
    @JvmStatic external fun nativeInitFlacEncoder(outputPath: String, sampleRate: Int, channels: Int): Boolean
    @JvmStatic external fun nativeFeedPcm(pcmData: ShortArray, numSamples: Int): Boolean
    @JvmStatic external fun nativeStopFlacEncoder(): Array<Any?>

    fun emitAppForeground() {
      isAppBackgrounded = false
      instance?.let { module ->
        module.sendEvent("onAppForeground", emptyMap<String, Any>())
      }
    }

    fun emitAppBackground() {
      isAppBackgrounded = true
      instance?.let { module ->
        module.sendEvent("onAppBackground", emptyMap<String, Any>())
      }
    }
  }

  fun sendForegroundAppEvent(packageName: String) {
    this@EkweNativeModule.sendEvent("onForegroundAppChanged", mapOf(
      "packageName" to packageName
    ))
  }

  override fun definition() = ModuleDefinition {

    Name("EkweNative")

    OnCreate {
      instance = this@EkweNativeModule
    }

    OnDestroy {
      instance = null
    }

    Events("onStateChanged", "onIntentQueued", "onAppForeground", "onAppBackground", "onForegroundAppChanged")

    // --- State Methods ---
    AsyncFunction("getWindowState") { ->
      FloatingStateEngine.getState().name
    }

    // --- Bubble Window Methods ---
    AsyncFunction("showBubble") { x: Double, y: Double ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_START
      }
      appContext.reactContext?.startForegroundService(intent)
    }

    AsyncFunction("dismissBubble") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_STOP
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("dismissEcho") { ->
      val activity = appContext.currentActivity
      if (activity is ShareActivity) {
        activity.dismissNativeLoader()
      }
      activity?.finish()
    }

    AsyncFunction("dismissNativeLoader") { ->
      val activity = appContext.currentActivity
      if (activity is ShareActivity) {
        activity.dismissNativeLoader()
        Log.d("EkweNative", "Native loader dismissed by RN")
      }
    }

    AsyncFunction("deleteFile") { uriString: String ->
      try {
        val uri = if (uriString.startsWith("file://")) uriString.substring(7) else uriString
        val file = java.io.File(uri)
        if (file.exists()) {
          file.delete()
        }
        true
      } catch (e: Exception) {
        Log.e("EkweNative", "Failed to delete file: $uriString", e)
        false
      }
    }

    AsyncFunction("expandBubble") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_EXPAND_BUBBLE
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("collapseBubble") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_COLLAPSE_BUBBLE
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("updateBubbleMode") { mode: String, data: String? ->
      val ctx = appContext.reactContext ?: return@AsyncFunction
      val intent = Intent(ctx, BubbleService::class.java).apply {
        action = BubbleService.ACTION_UPDATE_STATE
        putExtra(BubbleService.EXTRA_MODE, mode)
        putExtra(BubbleService.EXTRA_DATA, data)
      }
      ctx.startService(intent)
    }

    // --- Overlay Window Methods ---
    AsyncFunction("showOverlay") { audioPath: String, sourceApp: String ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_SHOW_OVERLAY
        putExtra(BubbleService.EXTRA_AUDIO_PATH, audioPath)
        putExtra(BubbleService.EXTRA_SOURCE_APP, sourceApp)
      }
      appContext.reactContext?.startForegroundService(intent)
    }

    AsyncFunction("dismissOverlay") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_DISMISS_OVERLAY
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("setOverlayHeight") { heightPx: Double, animated: Boolean ->
      // NO-OP for now, implemented later if needed
    }

    // --- Overlay Permissions ---
    AsyncFunction("hasOverlayPermission") { ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      Settings.canDrawOverlays(context)
    }

    AsyncFunction("requestOverlayPermission") { ->
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION
      ).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      appContext.reactContext?.startActivity(intent)
    }

    // --- Position (retained) ---
    AsyncFunction("getSavedPosition") { ->
      val prefs = appContext.reactContext?.getSharedPreferences(
        "ekwe_bubble", Context.MODE_PRIVATE
      )
      val x = prefs?.getFloat("bubble_x", -1f) ?: -1f
      val y = prefs?.getFloat("bubble_y", -1f) ?: -1f

      if (x < 0f || y < 0f) {
        null
      } else {
        mapOf("x" to x.toDouble(), "y" to y.toDouble())
      }
    }

    AsyncFunction("savePosition") { x: Double, y: Double ->
      appContext.reactContext?.getSharedPreferences(
        "ekwe_bubble", Context.MODE_PRIVATE
      )?.edit()?.apply {
        putFloat("bubble_x", x.toFloat())
        putFloat("bubble_y", y.toFloat())
        apply()
      }
    }

    // --- Accessibility & Content Resolution ---
    AsyncFunction("resolveContentUri") { uriString: String ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      val uri = android.net.Uri.parse(uriString)

      if (uri.scheme != "content") return@AsyncFunction uriString

      try {
        val mimeType = context.contentResolver.getType(uri) ?: "audio/ogg"

        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
            ?: getExtensionFromContentUri(context, uri)
            ?: "opus"

        val fileName = "shared_voice_${System.currentTimeMillis()}.$extension"
        val cacheFile = java.io.File(context.cacheDir, fileName)

        context.contentResolver.openInputStream(uri)?.use { input ->
          java.io.FileOutputStream(cacheFile).use { output ->
            input.copyTo(output)
          }
        }

        Log.d("EkweNative", "Resolved content URI: mime=$mimeType, ext=$extension, path=${cacheFile.absolutePath}")
        return@AsyncFunction "file://${cacheFile.absolutePath}"
      } catch (e: Exception) {
        Log.e("EkweNative", "Failed to resolve content URI", e)
        return@AsyncFunction null
      }
    }

    // ─── New: Resolve content:// URI → FLAC directly (no temp file) ─────
    AsyncFunction("resolveAndConvertToFlac") { uriString: String, outputPath: String ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "success" to false, "error" to "No context", "durationMs" to 0, "waveform" to emptyList<Float>()
      )

      try {
        val uri = android.net.Uri.parse(uriString)
        val inputStream = context.contentResolver.openInputStream(uri)
            ?: return@AsyncFunction mapOf(
              "success" to false, "error" to "Cannot open content URI",
              "durationMs" to 0, "waveform" to emptyList<Float>()
            )

        val bytes = inputStream.use { it.readBytes() }

        val result = extractFromMemoryJNI(bytes, outputPath)
        val success = result[0] as Boolean
        val error = result[1] as String
        val durationMs = result[2] as Int
        val waveform = (result[3] as FloatArray).toList()

        return@AsyncFunction mapOf(
          "success" to success,
          "error" to error,
          "durationMs" to durationMs,
          "waveform" to waveform
        )
      } catch (e: Exception) {
        Log.e("EkweNative", "resolveAndConvertToFlac failed", e)
        return@AsyncFunction mapOf(
          "success" to false, "error" to (e.message ?: "Unknown error"),
          "durationMs" to 0, "waveform" to emptyList<Float>()
        )
      }
    }

    // ─── New: AudioRecord direct capture ─────────────────────────────────
    AsyncFunction("startAudioRecording") { outputPath: String, sampleRate: Int ->
      if (isAudioRecording) {
        return@AsyncFunction mapOf("success" to false, "error" to "Already recording")
      }

      try {
        val bufferSize = AudioRecord.getMinBufferSize(
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT
        )

        if (bufferSize == AudioRecord.ERROR || bufferSize == AudioRecord.ERROR_BAD_VALUE) {
          return@AsyncFunction mapOf("success" to false, "error" to "Invalid buffer size")
        }

        val initOk = nativeInitFlacEncoder(outputPath, sampleRate, 1)
        if (!initOk) {
          return@AsyncFunction mapOf("success" to false, "error" to "Failed to init FLAC encoder")
        }

        audioRecord = AudioRecord(
          MediaRecorder.AudioSource.MIC,
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          bufferSize
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
          nativeStopFlacEncoder()
          audioRecord?.release()
          audioRecord = null
          return@AsyncFunction mapOf("success" to false, "error" to "AudioRecord init failed")
        }

        // Attach audio effects to the AudioRecord session
        val sessionId = audioRecord!!.audioSessionId
        attachEffectsInternal(sessionId)

        audioRecord?.startRecording()
        isAudioRecording = true

        recordingThread = thread(name = "AudioRecord") {
          try {
            val buffer = ShortArray(bufferSize / 2)
            while (isAudioRecording) {
              val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
              if (read > 0) {
                nativeFeedPcm(buffer, read)
                // Compute RMS amplitude (0..1) for metering
                var sumSq = 0.0
                for (i in 0 until read) {
                  val s = buffer[i].toDouble()
                  sumSq += s * s
                }
                val rms = Math.sqrt(sumSq / read)
                currentAmplitude = (rms / 32768.0).toFloat()
              } else if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                break
              }
            }
          } catch (e: Exception) {
            Log.e("EkweNative", "AudioRecord thread crashed", e)
            currentAmplitude = 0f
          }
        }

        return@AsyncFunction mapOf("success" to true, "error" to "")
      } catch (e: Exception) {
        Log.e("EkweNative", "startAudioRecording failed", e)
        isAudioRecording = false
        audioRecord?.release()
        audioRecord = null
        return@AsyncFunction mapOf("success" to false, "error" to (e.message ?: "Unknown error"))
      }
    }

    AsyncFunction("stopAudioRecording") { ->
      if (!isAudioRecording) {
        return@AsyncFunction mapOf(
          "success" to false, "error" to "Not recording",
          "durationMs" to 0, "waveform" to emptyList<Float>()
        )
      }

      isAudioRecording = false

      recordingThread?.interrupt()
      try {
        recordingThread?.join(3000)
      } catch (_: InterruptedException) {
        recordingThread?.interrupt()
      }
      recordingThread = null

      try {
        audioRecord?.stop()
      } catch (_: IllegalStateException) { }

      audioRecord?.release()
      audioRecord = null

      releaseEffectsInternal()

      val result = nativeStopFlacEncoder()
      val success = result[0] as Boolean
      val error = result[1] as String
      val durationMs = result[2] as Int
      val waveform = (result[3] as FloatArray).toList()

      return@AsyncFunction mapOf(
        "success" to success,
        "error" to error,
        "durationMs" to durationMs,
        "waveform" to waveform
      )
    }

    // --- Audio Conversion Methods ---
    AsyncFunction("extractWavAndWaveform") { inputPath: String, outputPath: String ->
      val result = extractWavAndWaveformJNI(inputPath, outputPath)
      val success = result[0] as Boolean
      val error = result[1] as String
      val durationMs = result[2] as Int
      val waveform = (result[3] as FloatArray).toList()
      return@AsyncFunction mapOf(
        "success" to success,
        "error" to error,
        "durationMs" to durationMs,
        "waveform" to waveform
      )
    }

    // --- Audio Effects Methods ---
    // ─── New: Get current recording amplitude (0..1) for metering ─────
    AsyncFunction("getRecordingAmplitude") { ->
      currentAmplitude.toDouble()
    }

    AsyncFunction("attachEffects") { audioSessionId: Double ->
      val sessionId = audioSessionId.toInt()
      attachEffectsInternal(sessionId)
    }

    AsyncFunction("releaseEffects") { ->
      releaseEffectsInternal()
    }
  }

  private fun attachEffectsInternal(sessionId: Int): Map<String, Boolean> {
    val result = mutableMapOf<String, Boolean>()
    try {
      if (NoiseSuppressor.isAvailable()) {
        noiseSuppressor = NoiseSuppressor.create(sessionId)
        noiseSuppressor?.enabled = true
        result.put("noiseSuppressor", true)
      } else {
        result.put("noiseSuppressor", false)
      }
    } catch (e: Exception) {
      result.put("noiseSuppressor", false)
    }
    try {
      if (AcousticEchoCanceler.isAvailable()) {
        echoCanceler = AcousticEchoCanceler.create(sessionId)
        echoCanceler?.enabled = true
        result.put("echoCanceler", true)
      } else {
        result.put("echoCanceler", false)
      }
    } catch (e: Exception) {
      result.put("echoCanceler", false)
    }
    try {
      if (AutomaticGainControl.isAvailable()) {
        gainControl = AutomaticGainControl.create(sessionId)
        gainControl?.enabled = true
        result.put("gainControl", true)
      } else {
        result.put("gainControl", false)
      }
    } catch (e: Exception) {
      result.put("gainControl", false)
    }
    return result
  }

  private fun releaseEffectsInternal() {
    noiseSuppressor?.release()
    echoCanceler?.release()
    gainControl?.release()
    noiseSuppressor = null
    echoCanceler = null
    gainControl = null
  }

  /**
   * Extracts file extension from the content URI's display name.
   */
  private fun getExtensionFromContentUri(context: Context, uri: android.net.Uri): String? {
    try {
      val cursor = context.contentResolver.query(uri, null, null, null, null)
      cursor?.use {
        if (it.moveToFirst()) {
          val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIndex >= 0) {
            val name = it.getString(nameIndex)
            val dotIndex = name?.lastIndexOf('.') ?: -1
            if (dotIndex >= 0 && name != null) {
              return name.substring(dotIndex + 1).lowercase()
            }
          }
        }
      }
    } catch (e: Exception) {
      Log.w("EkweNative", "Could not extract extension from content URI", e)
    }
    return null
  }
}
