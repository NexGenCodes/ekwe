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
  private var recordingStartedAt = 0L
  @Volatile
  private var currentAmplitude: Float = 0f

  companion object {
    var instance: EkweNativeModule? = null

    init {
      System.loadLibrary("ekwe_native_jni")
    }

    // Strip file:// prefix from JS paths — C/C++ fopen() doesn't understand URIs
    private fun resolvePath(path: String): String {
      return if (path.startsWith("file://")) path.substring(7) else path
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

    @JvmStatic fun emitOpusPacketFromNative(packetData: ByteArray, rms: Float) {
      instance?.let { module ->
        val base64Data = android.util.Base64.encodeToString(packetData, android.util.Base64.NO_WRAP)
        module.sendEvent("onOpusPacket", mapOf(
          "packet" to base64Data,
          "rms" to rms
        ))
      }
    }

    @JvmStatic fun emitVadSilenceFromNative() {
      instance?.let { module ->
        module.isAudioRecording = false
        module.sendEvent("onVadSilence", emptyMap<String, Any>())
      }
    }

    // --- JSI bindings: access C++ RMS from JS thread via host function ---
    @JvmStatic external fun nativeInstallJsi(jsContextPointer: Long)

    // --- Native Audio Processing (JNI) ---
    @JvmStatic external fun extractWavAndWaveformJNI(inputPath: String, outputPath: String): Array<Any?>
    @JvmStatic external fun encodePcmToOpusJNI(pcmData: ShortArray, sampleRate: Int, channels: Int, outputPath: String): Array<Any?>

    // New: memory-based decode (no temp file for content:// → FLAC)
    @JvmStatic external fun extractFromMemoryJNI(data: ByteArray, outputPath: String): Array<Any?>

    // Capture controller JNI (dual-path: file or live)
    @JvmStatic external fun nativeInitCapture(outputPath: String, sampleRate: Int, channels: Int, isLive: Boolean): Boolean
    @JvmStatic external fun nativeFeedPcm(pcmData: ShortArray, numSamples: Int): Boolean
    @JvmStatic external fun nativeStopCapture(): Boolean
    @JvmStatic external fun nativeGetAmplitude(): Float
    @JvmStatic external fun nativeGetLastWaveform(): FloatArray

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
      installJsiBindings()
    }

    OnDestroy {
      instance = null
    }

    Events("onStateChanged", "onIntentQueued", "onAppForeground", "onAppBackground", "onForegroundAppChanged", "onOpusPacket", "onVadSilence")

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
        val uri = resolvePath(uriString)
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
            ?: "ogg"

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

    // ─── Resolve content:// URI → Ogg Opus directly (no temp file) ─────
    AsyncFunction("resolveAndConvertToOpus") { uriString: String, outputPath: String ->
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

        val result = extractFromMemoryJNI(bytes, resolvePath(outputPath))
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
        Log.e("EkweNative", "resolveAndConvertToOpus failed", e)
        return@AsyncFunction mapOf(
          "success" to false, "error" to (e.message ?: "Unknown error"),
          "durationMs" to 0, "waveform" to emptyList<Float>()
        )
      }
    }

    // ─── AudioRecord direct capture (dual-path: file or live) ────────────
    AsyncFunction("startAudioRecording") { outputPath: String, sampleRate: Int, isLive: Boolean ->
      val methodStart = System.currentTimeMillis()
      Log.d("EkweAudio", "startAudioRecording: path=$outputPath sr=$sampleRate live=$isLive")
      if (isAudioRecording) {
        Log.w("EkweAudio", "startAudioRecording: already recording, rejecting")
        return@AsyncFunction mapOf("success" to false, "error" to "Already recording")
      }

      try {
        val bufferSize = AudioRecord.getMinBufferSize(
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT
        )
        Log.d("EkweAudio", "startAudioRecording: bufferSize=$bufferSize")

        if (bufferSize == AudioRecord.ERROR || bufferSize == AudioRecord.ERROR_BAD_VALUE) {
          Log.e("EkweAudio", "startAudioRecording: invalid buffer size")
          return@AsyncFunction mapOf("success" to false, "error" to "Invalid buffer size")
        }

        val nativeOutputPath = resolvePath(outputPath)
        Log.d("EkweAudio", "startAudioRecording: calling nativeInitCapture...")
        val initOk = nativeInitCapture(nativeOutputPath, sampleRate, 1, isLive)
        Log.d("EkweAudio", "startAudioRecording: nativeInitCapture returned $initOk")
        if (!initOk) {
          return@AsyncFunction mapOf("success" to false, "error" to "Failed to init capture")
        }

        Log.d("EkweAudio", "startAudioRecording: creating AudioRecord...")
        audioRecord = AudioRecord(
          MediaRecorder.AudioSource.MIC,
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
          bufferSize
        )
        Log.d("EkweAudio", "startAudioRecording: AudioRecord state=${audioRecord?.state}")

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
          Log.e("EkweAudio", "startAudioRecording: AudioRecord not initialized, stopping capture")
          nativeStopCapture()
          audioRecord?.release()
          audioRecord = null
          return@AsyncFunction mapOf("success" to false, "error" to "AudioRecord init failed")
        }

        val sessionId = audioRecord!!.audioSessionId

        Log.d("EkweAudio", "startAudioRecording: calling startRecording...")
        audioRecord?.startRecording()
        isAudioRecording = true
        recordingStartedAt = System.currentTimeMillis()
        
        Log.d("EkweAudio", "startAudioRecording: sessionId=$sessionId, attaching effects...")
        try {
          val effStart = System.currentTimeMillis()
          attachEffectsInternal(sessionId)
          val effEnd = System.currentTimeMillis()
          Log.d("EkweAudioPerf", "attachEffectsInternal JNI took \${effEnd - effStart}ms")
        } catch (e: Exception) {
          Log.e("EkweAudio", "Failed to attach audio effects", e)
        }

        Log.d("EkweAudio", "startAudioRecording: recording started, spinning up thread...")

        recordingThread = thread(name = "AudioRecord") {
          try {
            val buffer = ShortArray(bufferSize / 2)
            var frameCount = 0
            Log.d("EkweAudio", "AudioRecord thread: starting loop")
            while (isAudioRecording) {
              val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
              if (read > 0) {
                frameCount++
                if (frameCount == 1) Log.d("EkweAudio", "AudioRecord thread: first frame read=$read")
                nativeFeedPcm(buffer, read)
                // RMS from native capture controller
                currentAmplitude = nativeGetAmplitude()
              } else if (read == AudioRecord.ERROR_INVALID_OPERATION) {
                Log.w("EkweAudio", "AudioRecord thread: ERROR_INVALID_OPERATION, breaking")
                break
              }
            }
            Log.d("EkweAudio", "AudioRecord thread: exiting loop, processed $frameCount frames")
          } catch (e: Exception) {
            Log.e("EkweAudio", "AudioRecord thread crashed: ${e.message}", e)
            currentAmplitude = 0f
          }
        }

        Log.d("EkweAudio", "startAudioRecording: returning success")
        val methodEnd = System.currentTimeMillis()
        Log.d("EkweAudioPerf", "startAudioRecording JNI took \${methodEnd - methodStart}ms")
        return@AsyncFunction mapOf("success" to true, "error" to "")
      } catch (e: Exception) {
        Log.e("EkweAudio", "startAudioRecording failed: ${e.message}", e)
        isAudioRecording = false
        audioRecord?.release()
        audioRecord = null
        return@AsyncFunction mapOf("success" to false, "error" to (e.message ?: "Unknown error"))
      }
    }

    AsyncFunction("getRecordingAmplitude") { ->
      val amp = currentAmplitude
      Log.d("EkweAudio", "getRecordingAmplitude: $amp")
      amp.toDouble()
    }

    AsyncFunction("stopAudioRecording") { ->
      val methodStart = System.currentTimeMillis()
      Log.d("EkweAudio", "stopAudioRecording called, isRecording=$isAudioRecording")
      if (!isAudioRecording) {
        return@AsyncFunction mapOf(
          "success" to false, "error" to "Not recording",
          "durationMs" to 0, "waveform" to emptyList<Float>()
        )
      }

      isAudioRecording = false

      // Unblock the audioRecord.read() loop IMMEDIATELY
      try {
        audioRecord?.stop()
      } catch (_: IllegalStateException) { }

      recordingThread?.interrupt()
      try {
        recordingThread?.join(500) // Should die instantly now
      } catch (_: InterruptedException) {
        recordingThread?.interrupt()
      }
      recordingThread = null

      audioRecord?.release()
      audioRecord = null

      releaseEffectsInternal()

      Log.d("EkweAudio", "stopAudioRecording: calling nativeStopCapture...")
      val stopOk = nativeStopCapture()
      Log.d("EkweAudio", "stopAudioRecording: nativeStopCapture returned $stopOk")

      val waveform = nativeGetLastWaveform().toList()
      Log.d("EkweAudio", "stopAudioRecording: waveform bins=${waveform.size}")

      val methodEnd = System.currentTimeMillis()
      Log.d("EkweAudioPerf", "stopAudioRecording JNI took \${methodEnd - methodStart}ms")

      val durationMs = (System.currentTimeMillis() - recordingStartedAt)
        .toInt()
        .coerceAtLeast(0)

      return@AsyncFunction mapOf(
        "success" to true,
        "error" to "",
        "durationMs" to durationMs,
        "waveform" to waveform
      )
    }



    // --- Audio Conversion Methods ---
    AsyncFunction("extractWavAndWaveform") { inputPath: String, outputPath: String ->
      val result = extractWavAndWaveformJNI(resolvePath(inputPath), resolvePath(outputPath))
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
   * Installs the ekweNativeGetAmplitude JSI host function on the JS runtime,
   * giving the JS thread direct synchronous access to the capture controller's
   * current RMS value without bridge overhead.
   */
  private fun installJsiBindings() {
    val reactContext = appContext.reactContext as? com.facebook.react.bridge.ReactContext ?: return
    val holder = reactContext.javaScriptContextHolder ?: return
    nativeInstallJsi(holder.get())
    Log.d("EkweNative", "JSI bindings installed")
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
