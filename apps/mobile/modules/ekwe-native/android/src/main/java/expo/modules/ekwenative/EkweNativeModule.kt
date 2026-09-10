package expo.modules.ekwenative

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioFocusRequest
import android.media.MediaRecorder
import android.os.Build
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.concurrent.thread

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  // AudioRecord capture state. These are read/written from three threads — the
  // JS thread (start/stop), the AudioRecord loop, and the C++ capture thread
  // (emitVadSilenceFromNative) — so every field needs volatile visibility to
  // avoid stale reads (e.g. the loop never seeing a stop, or the VAD stop and a
  // concurrent JS stop racing on release).
  @Volatile
  private var audioRecord: AudioRecord? = null
  @Volatile
  private var isAudioRecording = false
  @Volatile
  private var recordingThread: Thread? = null
  @Volatile
  private var recordingStartedAt = 0L
  @Volatile
  private var currentAmplitude: Float = 0f

  // Audio focus state — request GAIN_TRANSIENT before recording so other apps
  // (music, podcasts) duck, and abandon when recording stops. Pre-API 26
  // (minSdk 24) uses the deprecated listener-based API; API 26+ uses
  // AudioFocusRequest which also carries AudioAttributes for the system to
  // understand *why* we're requesting focus (voice communication).
  private var audioFocusRequest: AudioFocusRequest? = null
  @Volatile
  private var isAudioFocusHeld = false
  private val legacyFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    if (focusChange != AudioManager.AUDIOFOCUS_GAIN && isAudioRecording) {
      Log.w("EkweAudio", "Audio focus lost ($focusChange), stopping recording")
      // performStop is idempotent and safe from any thread
      performStop()
      // Notify JS to update UI state
      nativeDispatchVadSilence()
    }
  }

  companion object {
    var instance: EkweNativeModule? = null

    // Authoritative limit lives in @ekwe/shared/plans (PREMIUM_LIMITS.
    // maxAudioBytes); JS passes it in at call time so native never hardcodes it.
    // This is only a defensive default if a caller omits the argument.
    private const val DEFAULT_MAX_AUDIO_BYTES = 26_214_400L

    init {
      System.loadLibrary("ekwe_native_jni")
    }

    // Query the provider-declared size for a content:// uri (best-effort).
    private fun queryContentSize(context: Context, uri: android.net.Uri): Long? {
      return try {
        context.contentResolver.query(
          uri,
          arrayOf(android.provider.OpenableColumns.SIZE),
          null, null, null,
        )?.use { cursor ->
          val index = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
          if (index >= 0 && cursor.moveToFirst() && !cursor.isNull(index)) {
            cursor.getLong(index)
          } else {
            null
          }
        }
      } catch (e: Exception) {
        Log.w("EkweNative", "queryContentSize failed", e)
        null
      }
    }

    // Strip file:// prefix from JS paths — C/C++ fopen() doesn't understand URIs
    private fun resolvePath(path: String): String {
      return if (path.startsWith("file://")) path.substring(7) else path
    }

    // Sanitize the JS-supplied limit so a 0/negative value (caller bug) falls
    // back to the authoritative shared default instead of rejecting everything.
    private fun sanitizeMaxAudioBytes(maxAudioBytes: Long): Long {
      return if (maxAudioBytes > 0) maxAudioBytes else DEFAULT_MAX_AUDIO_BYTES
    }
    // --- JNI hooks ---
    @JvmStatic external fun nativeDispatchVadSilence()

    // --- Native Audio Processing (JNI) ---
    @JvmStatic external fun transcodeToOpusWithWaveformJNI(inputPath: String, outputPath: String, maxAudioBytes: Long): Array<Any?>
    @JvmStatic external fun encodePcmToOpusJNI(pcmData: ShortArray, sampleRate: Int, channels: Int, outputPath: String): Array<Any?>

    // New: memory-based decode (no temp file for content:// → FLAC)
    @JvmStatic external fun transcodeFromMemoryJNI(data: ByteArray, outputPath: String, maxAudioBytes: Long): Array<Any?>

    // Capture controller JNI (dual-path: file or live)
    @JvmStatic external fun nativeInitCapture(outputPath: String, sampleRate: Int, channels: Int, isLive: Boolean): Boolean
    @JvmStatic external fun nativeFeedPcm(pcmData: ShortArray, numSamples: Int): Boolean
    @JvmStatic external fun nativeStopCapture(): Boolean
    @JvmStatic external fun nativeGetAmplitude(): Float
    @JvmStatic external fun nativeGetLastWaveform(): FloatArray
  }

  override fun definition() = ModuleDefinition {

    Name("EkweNative")

    OnCreate {
      instance = this@EkweNativeModule
    }

    OnDestroy {
      instance = null
    }

    // --- Echo (Share Intent) Methods ---
    // Echo runs inside the translucent ShareActivity overlay. dismissNativeLoader
    // only removes the native "Preparing voice note…" card once RN is interactive;
    // dismissEcho finishes the overlay so the user returns to the source app.
    AsyncFunction("dismissEcho") { ->
      val activity = appContext.currentActivity
      if (activity is ShareActivity) {
        activity.dismissNativeLoader()
        activity.finish()
      }
    }

    // Authoritative device theme, read straight from the OS. React Native's
    // Appearance cache can go stale in the ShareActivity's JS context (it only
    // refreshes once the main activity foregrounds and delivers a config change),
    // so the share overlay must not trust `useColorScheme()` alone — this bypasses
    // the cache entirely and always reflects the *resolved* night mode (including
    // auto / scheduled themes).
    Function("getSystemTheme") {
      val context = appContext.reactContext ?: return@Function "light"
      val uiMode = context.resources.configuration.uiMode
      val nightActive =
        uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
          android.content.res.Configuration.UI_MODE_NIGHT_YES
      if (nightActive) "dark" else "light"
    }

    // Release pipelines publish a single universal APK, so there is no
    // per-ABI download anymore and no need to expose the device ABI to JS.

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

    AsyncFunction("writeSharedFile") { fileName: String, content: String ->
      true
    }

    // --- Accessibility & Content Resolution ---
    AsyncFunction("resolveContentUri") { uriString: String, maxAudioBytes: Long ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      val uri = android.net.Uri.parse(uriString)
      val limit = sanitizeMaxAudioBytes(maxAudioBytes)

      if (uri.scheme != "content") return@AsyncFunction uriString

      try {
        val mimeType = context.contentResolver.getType(uri) ?: "audio/ogg"

        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
            ?: getExtensionFromContentUri(context, uri)
            ?: "ogg"

        // Reject oversized content:// sources BEFORE copying to cache.
        val declaredSize = queryContentSize(context, uri)
        if (declaredSize != null && declaredSize > limit) {
          Log.w("EkweNative", "resolveContentUri rejected: size=$declaredSize over limit")
          return@AsyncFunction null
        }

        val fileName = "shared_voice_${System.currentTimeMillis()}.$extension"
        val cacheFile = java.io.File(context.cacheDir, fileName)

        val copied = context.contentResolver.openInputStream(uri)?.use { input ->
          java.io.FileOutputStream(cacheFile).use { output ->
            // Bounded copy so an oversized provider stream cannot fill the cache.
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var total = 0L
            while (true) {
              val read = input.read(buffer)
              if (read <= 0) break
              total += read
              if (total > limit) break
              output.write(buffer, 0, read)
            }
            total <= limit
          }
        } ?: false

        if (!copied) {
          cacheFile.delete()
          Log.w("EkweNative", "resolveContentUri rejected: source over limit")
          return@AsyncFunction null
        }

        Log.d("EkweNative", "Resolved content URI: mime=$mimeType, ext=$extension, path=${cacheFile.absolutePath}")
        return@AsyncFunction "file://${cacheFile.absolutePath}"
      } catch (e: Exception) {
        Log.e("EkweNative", "Failed to resolve content URI", e)
        return@AsyncFunction null
      }
    }

    // ─── Resolve content:// URI → Ogg Opus directly (no temp file) ─────
    AsyncFunction("resolveAndTranscodeToOpus") { uriString: String, outputPath: String, maxAudioBytes: Long ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "success" to false, "error" to "No context", "durationMs" to 0, "waveform" to emptyList<Float>()
      )
      val limit = sanitizeMaxAudioBytes(maxAudioBytes)

      try {
        val uri = android.net.Uri.parse(uriString)

        // Guard: reject oversized content:// sources BEFORE buffering into
        // memory. Prevents a large shared file from being fully loaded + decoded.
        val declaredSize = queryContentSize(context, uri)
        if (declaredSize != null && declaredSize > limit) {
          Log.w("EkweNative", "resolveAndTranscodeToOpus rejected: size=$declaredSize over limit")
          return@AsyncFunction mapOf(
            "success" to false, "error" to "FILE_TOO_LARGE",
            "durationMs" to 0, "waveform" to emptyList<Float>()
          )
        }

        val inputStream = context.contentResolver.openInputStream(uri)
            ?: return@AsyncFunction mapOf(
              "success" to false, "error" to "Cannot open content URI",
              "durationMs" to 0, "waveform" to emptyList<Float>()
            )

        // Bounded read: copy at most limit + 1 bytes so a
        // provider that lies about its declared size (or omits SIZE entirely)
        // cannot make us buffer an unbounded stream into memory.
        val bytes = inputStream.use { stream ->
          val buffer = java.io.ByteArrayOutputStream()
          val chunk = ByteArray(DEFAULT_BUFFER_SIZE)
          var total = 0L
          while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            total += read
            // Hard cap: once total bytes read exceeds the limit we must reject,
            // not just stop buffering. Breaking before writing the crossing
            // chunk would silently keep bytes.size <= limit and let the check
            // below never fire, truncating the transcoded clip without error.
            if (total > limit) {
              Log.w("EkweNative", "resolveAndTranscodeToOpus rejected: bytes=$total over limit")
              return@AsyncFunction mapOf(
                "success" to false, "error" to "FILE_TOO_LARGE",
                "durationMs" to 0, "waveform" to emptyList<Float>()
              )
            }
            buffer.write(chunk, 0, read)
          }
          buffer.toByteArray()
        }

        val result = transcodeFromMemoryJNI(bytes, resolvePath(outputPath), limit)
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

        Log.d("EkweAudio", "startAudioRecording: requesting audio focus...")
        requestAudioFocus()

        Log.d("EkweAudio", "startAudioRecording: creating AudioRecord...")
        // VOICE_COMMUNICATION routes the mic through the call-mode DSP path:
        // built-in acoustic echo cancellation, noise suppression and automatic
        // gain control with ~20ms latency — the best production-quality speech
        // capture for dictation/translation. The manual audiofx effects attached
        // below are best-effort on top; where the framework already applies them
        // isAvailable() reports false and the attach is skipped, so there is no
        // double-processing. Fall back to the raw MIC source on old devices that
        // don't honor the call-mode source.
        val source =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            MediaRecorder.AudioSource.VOICE_COMMUNICATION
          } else {
            MediaRecorder.AudioSource.MIC
          }
        audioRecord = AudioRecord(
          source,
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
          abandonAudioFocus()
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
          Log.d("EkweAudioPerf", "attachEffectsInternal JNI took ${effEnd - effStart}ms")
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
        Log.d("EkweAudioPerf", "startAudioRecording JNI took ${methodEnd - methodStart}ms")
        return@AsyncFunction mapOf("success" to true, "error" to "")
      } catch (e: Exception) {
        Log.e("EkweAudio", "startAudioRecording failed: ${e.message}", e)
        isAudioRecording = false
        audioRecord?.release()
        audioRecord = null
        abandonAudioFocus()
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

      // Idempotent teardown: the VAD path may already have released everything
      // when onVadSilence fired (see emitVadSilenceFromNative). In that case we
      // must still return the recorded waveform/duration so the JS auto-stop can
      // build a valid RecordingResult, instead of early-returning
      // "Not recording" and leaking. This is the single reader of the native
      // waveform buffer — the VAD callback never consumes it.
      performStop()
      val waveform = nativeGetLastWaveform().toList()
      Log.d("EkweAudio", "stopAudioRecording: waveform bins=${waveform.size}")

      val durationMs = (System.currentTimeMillis() - recordingStartedAt)
        .toInt()
        .coerceAtLeast(0)
        .toLong()

      val methodEnd = System.currentTimeMillis()
      Log.d("EkweAudioPerf", "stopAudioRecording JNI took ${methodEnd - methodStart}ms")

      return@AsyncFunction mapOf(
        "success" to true,
        "error" to "",
        "durationMs" to durationMs,
        "waveform" to waveform
      )
    }

    // --- Audio Conversion Methods ---
    AsyncFunction("transcodeToOpusWithWaveform") { inputPath: String, outputPath: String, maxAudioBytes: Long ->
      val result = transcodeToOpusWithWaveformJNI(resolvePath(inputPath), resolvePath(outputPath), sanitizeMaxAudioBytes(maxAudioBytes))
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

  /**
   * Requests transient audio focus so other apps (music, podcasts) duck while
   * we record. API 26+ uses the modern AudioFocusRequest with AudioAttributes
   * tagged as VOICE_COMMUNICATION; pre-26 uses the deprecated listener-based
   * API. Both paths share one focus-abandon path for cleanup.
   */
  private fun requestAudioFocus() {
    if (isAudioFocusHeld) return
    val ctx = appContext.reactContext ?: return
    val audioManager = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(legacyFocusChangeListener)
        .setAcceptsDelayedFocusGain(false)
        .build()
      val result = audioManager.requestAudioFocus(request)
      if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        audioFocusRequest = request
        isAudioFocusHeld = true
        Log.d("EkweAudio", "Audio focus granted (API 26+)")
      } else {
        Log.w("EkweAudio", "Audio focus denied (API 26+): $result")
      }
    } else {
      @Suppress("DEPRECATION")
      val result = audioManager.requestAudioFocus(
        legacyFocusChangeListener,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
      )
      if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        isAudioFocusHeld = true
        Log.d("EkweAudio", "Audio focus granted (legacy)")
      } else {
        Log.w("EkweAudio", "Audio focus denied (legacy): $result")
      }
    }
  }

  /**
   * Abandons audio focus if held. Must be safe to call from any thread and
   * idempotent — performStop shares this teardown path.
   */
  private fun abandonAudioFocus() {
    if (!isAudioFocusHeld) return
    val ctx = appContext.reactContext ?: return
    val audioManager = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(legacyFocusChangeListener)
    }
    isAudioFocusHeld = false
    Log.d("EkweAudio", "Audio focus abandoned")
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

  /**
   * Releases AudioRecord + effects and stops the native capture controller.
   * Idempotent and callable from any thread, so both stopAudioRecording (JS
   * thread) and emitVadSilenceFromNative (C++ capture callback, which runs ON
   * the AudioRecord thread) share one teardown path. When invoked from the
   * recording thread itself we skip the join — the read loop exits naturally
   * once isAudioRecording is false. Does NOT read nativeGetLastWaveform():
   * that buffer is cleared on read, so stopAudioRecording owns it exclusively.
   */
  private fun performStop() = synchronized(this) {
    isAudioRecording = false

    // Unblock the audioRecord.read() loop IMMEDIATELY
    try {
      audioRecord?.stop()
    } catch (_: IllegalStateException) { }

    val thread = recordingThread
    if (thread != null && thread !== Thread.currentThread()) {
      thread.interrupt()
      try {
        thread.join(500) // Should die instantly now
      } catch (_: InterruptedException) {
        thread.interrupt()
      }
    }
    recordingThread = null

    audioRecord?.release()
    audioRecord = null

    releaseEffectsInternal()

    Log.d("EkweAudio", "performStop: calling nativeStopCapture...")
    val stopOk = nativeStopCapture()
    Log.d("EkweAudio", "performStop: nativeStopCapture returned $stopOk")

    abandonAudioFocus()
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
