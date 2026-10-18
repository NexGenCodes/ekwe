package expo.modules.ekwenative

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
import androidx.core.content.FileProvider
import expo.modules.ekwenative.orb.OrbConsent
import expo.modules.ekwenative.orb.OrbCaptureService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.concurrent.thread

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  // AudioRecord capture state. These are read/written from three threads — the
  // JS thread (start/stop), the read loop, and the C++ capture thread
  // (emitVadSilenceFromNative) — so every field needs volatile visibility to
  // avoid stale reads (e.g. the loop never seeing a stop, or the VAD stop and a
  // concurrent JS stop racing on release). The read loop itself lives in
  // PcmCaptureLoop, shared with Orb playback capture.
  @Volatile
  private var audioRecord: AudioRecord? = null
  @Volatile
  private var captureLoopRef: PcmCaptureLoop? = null
  @Volatile
  private var isAudioRecording = false
  @Volatile
  private var recordingStartedAt = 0L

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
      // The listener is delivered on the main looper, and performStop() joins
      // the capture thread and re-decodes the finished Ogg to derive the
      // waveform. Doing that inline is an ANR on an ordinary event like an
      // incoming call, so the teardown moves off the main thread.
      thread(name = "EkweFocusTeardown") {
        performStop()
        nativeDispatchVadSilence()
      }
    }
  }

  companion object {
    var instance: EkweNativeModule? = null

    // The authoritative limit is PREMIUM_LIMITS.maxAudioBytes in
    // @ekwe/shared/plans, passed in per call; this is a fallback for a caller
    // that omits it.
    private const val DEFAULT_MAX_AUDIO_BYTES = 10_485_760L

    // Matches PREMIUM_LIMITS.dictationDurationMs (30 min). Free tier passes a
    // tighter value via maxDurationMs in the options bundle.
    private const val DEFAULT_MAX_DURATION_MS = 30L * 60L * 1000L

    // MediaMetadataRetriever is not maintained for Ogg/Opus and returns garbage
    // on many devices (observed: a constant 2,783,138,807 ms ~= 32 days for any
    // Ogg file, regardless of its real length). Any value outside this range is
    // treated as "unknown" rather than a real duration.
    private const val MAX_PLAUSIBLE_DURATION_MS = 24L * 60L * 60L * 1000L

    // Generous input safety cap from @ekwe/shared/plans (MAX_AUDIO_INPUT_BYTES).
    // The tier cap applies to the transcoded output, not the original file.
    private const val MAX_AUDIO_INPUT_BYTES = 100L * 1024L * 1024L

    // Source duration without decoding; AMR falls back to the decode ceiling.
    private fun probeDurationMs(context: Context, uri: android.net.Uri): Long? {
        return try {
            val retriever = android.media.MediaMetadataRetriever()
            try {
                when (uri.scheme) {
                    "content" -> retriever.setDataSource(context, uri)
                    "file", null -> retriever.setDataSource(uri.path)
                    else -> return null
                }
                retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()
            } finally {
                try { retriever.release() } catch (_: IllegalStateException) {}
            }
        } catch (t: Throwable) {
            Log.w("EkweNative", "probeDurationMs failed for $uri", t)
            null
        }
    }

    // MediaMetadataRetriever result, discarded when implausible. This is the
    // only option for content:// streams we have not buffered yet; for Ogg files
    // prefer a `gateDurationMs`-style granule read instead.
    private fun metadataDurationMs(context: Context, uri: android.net.Uri): Long? =
        probeDurationMs(context, uri)?.takeIf { it in 1..MAX_PLAUSIBLE_DURATION_MS }

    // Duration used for the plan gate. Ogg/Opus is read from the granule position
    // in C++ (accurate); everything else uses platform metadata, discarding
    // implausible values so a broken retriever can never reject a valid clip.
    private fun gateDurationMs(context: Context, fsPath: String?, uri: android.net.Uri): Long? {
        if (fsPath != null) {
            val container = classifyAudioContainerJNI(fsPath)
            if (container == 1 || container == 2) {
                val granule = probeAudioDurationMsJNI(fsPath)
                if (granule > 0) return granule.toLong()
            }
        }
        return metadataDurationMs(context, uri)
    }

    // Reported alongside a rejection; never let a large probe overflow Int.
    private fun clampDurationToInt(ms: Long): Int =
        ms.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()

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
    @JvmStatic external fun probeAudioDurationMsJNI(inputPath: String): Int
    @JvmStatic external fun encodePcmToOpusJNI(pcmData: ShortArray, sampleRate: Int, channels: Int, outputPath: String): Array<Any?>
    @JvmStatic external fun classifyAudioContainerJNI(inputPath: String): Int
    @JvmStatic external fun encodePcmToDualJNI(pcmData: ShortArray, sampleRate: Int, channels: Int, opusPath: String, vorbisPath: String): Array<Array<Any?>>
    @JvmStatic external fun resolveOggToArtifactsJNI(inputPath: String, opusPath: String, vorbisPath: String, maxAudioBytes: Long): Array<Any?>

    // memory-based decode (no temp file for content:// shared audio)
    @JvmStatic external fun transcodeFromMemoryJNI(data: ByteArray, outputPath: String, maxAudioBytes: Long): Array<Any?>
    @JvmStatic external fun decodeFileToWavJNI(inputPath: String, outputPath: String, maxAudioBytes: Long): Array<Any?>

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

    // MediaProjection consent. Routed through startActivityForResult rather than
    // an ActivityResultLauncher because a launcher must be registered before
    // the host activity reaches STARTED, and this module is first touched from
    // JS long after the activity is RESUMED.
    OnActivityResult { _, payload ->
      val context = appContext.reactContext ?: return@OnActivityResult
      if (!OrbConsent.accepts(payload.requestCode)) return@OnActivityResult
      if (payload.resultCode != android.app.Activity.RESULT_OK || payload.data == null) {
        return@OnActivityResult
      }
      OrbConsent.start(context, payload.resultCode, payload.data)
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

    // Who installed Ekwe on this device. This is the *forward-compat* gate for
    // the in-app "New version" update badge:
    //
    //   store     → app came from a real distribution store (Play, Amazon,
    //               Galaxy, AppGallery, Xiaomi…). The store manages the native
    //               binary itself, so offering an APK download here is wrong —
    //               the badge auto-hides the day we publish, no code change.
    //   sideload → no recognized installer (adb install / direct APK). The
    //               binary can't self-update, so the badge + APK download are
    //               exactly right.
    //
    // Reads the OS installer package via the version-aware API (installSourceInfo
    // on API 30+, the deprecated installerPackageName on older). We never treat
    // "adb" as a store, and any unrecognized installer falls back to sideload so
    // the badge stays honest until we publish.
    Function("getInstallerSource") {
      val context = appContext.reactContext ?: return@Function "sideload"
      val installer =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          try {
            context.packageManager
              .getInstallSourceInfo(context.packageName)
              .installingPackageName
          } catch (e: Exception) {
            null
          }
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getInstallerPackageName(context.packageName)
        }

      when (installer) {
        null,
        "",
        "adb",
        "com.android.shell",
        -> "sideload"
        "com.android.vending", // Google Play
        "com.google.android.feedback", // Play beta
        "com.amazon.venezia", // Amazon Appstore
        "com.amazon.amazonapp", // Amazon
        "com.sec.android.app.samsungapps", // Galaxy Store
        "com.huawei.appmarket", // AppGallery
        "com.xiaomi.market", // Xiaomi / GetApps
        "com.bbk.launcher2", // Vivo
        "com.heytap.market", // OPPO
        "com.hihonor.appmarket", // Honor
        "com.oneplus.store", // OnePlus
        "com.fdroid", // F-Droid (its own signed build — treat as store,
        // though we won't publish there; keeping it means a hypothetical
        // future F-Droid build never shows a bogus sideload badge)
        -> "store"
        else -> "sideload"
      }
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

    // ─── Outgoing audio share ───────────────────────────────────────
    // Built here rather than through expo-sharing because that module sets the
    // type with Intent.setTypeAndNormalize(), which truncates at the first ";"
    // (AOSP Intent.normalizeMimeType). "audio/ogg; codecs=opus" would arrive as
    // "audio/ogg", and that parameter is load-bearing:
    //   * WhatsApp allow-lists exactly "audio/ogg; codecs=opus" (plus audio/m4a
    //     and audio/x-m4a) to render an incoming file as a PTT voice note.
    //   * Telegram requires the type to both start with "audio/ogg" and contain
    //     "codecs=opus" before it treats the file as a voice message.
    // Anything else lands as an ordinary audio attachment.
    //
    // This intent carries the stream and NOTHING else. Attaching EXTRA_TEXT
    // alongside EXTRA_STREAM makes it a composite send — "some text plus an
    // attachment" — and WhatsApp then classifies it as a document and renders
    // the file card instead of a voice note, waveform included. The MIME above
    // is only consulted for a stream-only send, so the caption has to be dropped
    // here rather than merely being secondary. iOS gets away with the same
    // caption because UIActivityViewController hands the target two independent
    // items; Android folds them into one intent, which is why only Android ever
    // showed a file. A transcript can still be shared, as its own text share.
    //
    // `text` is accepted and ignored so the JS signature stays in step with
    // iOS, which does pass the caption.
    //
    // Resolves once the chooser is on screen, not once the user picks a target:
    // callers only need to know the share was launched, and the receiving app
    // may still be reading the file long after this returns.
    AsyncFunction("shareAudio") {
        filePath: String, mimeType: String, text: String?, chooserTitle: String? ->
      val context = appContext.reactContext
        ?: return@AsyncFunction mapOf("success" to false, "error" to "No context")
      val activity = appContext.currentActivity
        ?: return@AsyncFunction mapOf("success" to false, "error" to "No foreground activity")

      val file = java.io.File(resolvePath(filePath))
      if (!file.exists()) {
        return@AsyncFunction mapOf("success" to false, "error" to "File not found")
      }

      try {
        val contentUri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.ekweshareprovider",
          file,
        )

        val send = Intent(Intent.ACTION_SEND).apply {
          putExtra(Intent.EXTRA_STREAM, contentUri)
          // setType, deliberately NOT setTypeAndNormalize — see note above.
          setType(mimeType)
          // Deliberately no EXTRA_TEXT. See the stream-only note above: a
          // caption on this intent costs the voice-note rendering. Logged so the
          // dropped caption is visible when a share is debugged.
          if (!text.isNullOrBlank()) {
            Log.d("EkweNative", "shareAudio: dropping caption to keep the PTT send stream-only")
          }
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        // The chooser does not reliably propagate the read grant on OEM
        // builds, so grant each resolved target explicitly. Without the
        // <queries> entry for ACTION_SEND this returns nothing on API 30+.
        context.packageManager
          .queryIntentActivities(send, PackageManager.MATCH_DEFAULT_ONLY)
          .forEach { info ->
            try {
              context.grantUriPermission(
                info.activityInfo.packageName,
                contentUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
              )
            } catch (e: SecurityException) {
              Log.w("EkweNative", "grantUriPermission denied for ${info.activityInfo.packageName}", e)
            }
          }

        activity.startActivity(Intent.createChooser(send, chooserTitle ?: "Share"))
        mapOf("success" to true, "error" to "")
      } catch (e: Exception) {
        Log.e("EkweNative", "shareAudio failed for $filePath", e)
        mapOf("success" to false, "error" to (e.message ?: "Share failed"))
      }
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
    AsyncFunction("resolveAndTranscodeToOpus") { uriString: String, outputPath: String, maxAudioBytes: Long, options: Map<String, Any?>? ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "success" to false, "error" to "No context", "durationMs" to 0, "waveform" to emptyList<Float>()
      )
      val outputCap = sanitizeMaxAudioBytes(maxAudioBytes)
      val inputCap = MAX_AUDIO_INPUT_BYTES
      val maxDurationMs =
        (options?.get("maxDurationMs") as? Number)?.toLong()?.takeIf { it > 0 }
          ?: DEFAULT_MAX_DURATION_MS

      // M4A playback copy (AAC-LC, decodable on every device) from the same
      // decode as the Opus artifact, encoded straight from the decoded PCM.
      val opusFsPath = resolvePath(outputPath)
      val m4aFsPath = "${opusFsPath.substringBeforeLast('.')}.m4a"

      try {
        val uri = android.net.Uri.parse(uriString)

        // Reject pathological sources before buffering — the duration gate
        // below is the real policy, this only stops decompression bombs.
        val declaredSize = queryContentSize(context, uri)
        if (declaredSize != null && declaredSize > inputCap) {
          Log.w("EkweNative", "resolveAndTranscodeToOpus rejected: size=$declaredSize over input cap")
          return@AsyncFunction mapOf(
            "success" to false, "error" to "FILE_TOO_LARGE",
            "durationMs" to 0, "waveform" to emptyList<Float>()
          )
        }

        // Duration gate on the ORIGINAL audio, before any decode work. If
        // MediaMetadataRetriever can't read it (raw AMR etc.), fall through
        // and rely on the decode ceiling plus the post-transcode check.
        val originalDurationMs = metadataDurationMs(context, uri)
        if (originalDurationMs != null && maxDurationMs > 0 && originalDurationMs > maxDurationMs) {
          Log.w("EkweNative", "resolveAndTranscodeToOpus rejected: duration=${originalDurationMs}ms > limit=${maxDurationMs}ms")
          return@AsyncFunction mapOf(
            "success" to false, "error" to "AUDIO_TOO_LONG",
            "durationMs" to clampDurationToInt(originalDurationMs), "waveform" to emptyList<Float>()
          )
        }

        // The C++ core decodes Ogg Opus and WAV itself (and resamples via
        // r8brain); every other container (MP3/AAC/M4A/FLAC/AMR/3GP/WebM) is
        // reported as PLATFORM_DECODE_REQUIRED and handled by the platform
        // decoder below.
        val inputStream = context.contentResolver.openInputStream(uri)
            ?: return@AsyncFunction mapOf(
              "success" to false, "error" to "Cannot open content URI",
              "durationMs" to 0, "waveform" to emptyList<Float>()
            )

        val bytes = inputStream.use { stream ->
          val buffer = java.io.ByteArrayOutputStream()
          val chunk = ByteArray(DEFAULT_BUFFER_SIZE)
          var total = 0L
          while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            total += read
            if (total > inputCap) {
              Log.w("EkweNative", "resolveAndTranscodeToOpus rejected: bytes=$total over input cap")
              return@AsyncFunction mapOf(
                "success" to false, "error" to "FILE_TOO_LARGE",
                "durationMs" to 0, "waveform" to emptyList<Float>()
              )
            }
            buffer.write(chunk, 0, read)
          }
          buffer.toByteArray()
        }

        val result = transcodeFromMemoryJNI(bytes, opusFsPath, inputCap)
        val success = result[0] as Boolean
        val error = result[1] as String
        val durationMs = result[2] as Int
        val waveform = (result[3] as FloatArray).toList()
        val decodedPcm = result[4] as ShortArray
        val decodedRate = result[5] as Int
        val decodedChannels = result[6] as Int

        if (!success && error == "PLATFORM_DECODE_REQUIRED") {
          // MP3/AAC/M4A/FLAC/AMR/3GP/WebM — route through the platform decoder.
          val pcm = PlatformAudioDecoder.decode(context, uri, maxDurationMs)
          if (pcm != null && pcm.durationMs > maxDurationMs && maxDurationMs > 0) {
            return@AsyncFunction mapOf(
              "success" to false, "error" to "AUDIO_TOO_LONG",
              "durationMs" to pcm.durationMs, "waveform" to emptyList<Float>()
            )
          }
          if (pcm != null) {
            val encResult = encodePcmToOpusJNI(pcm.samples, pcm.sampleRate, pcm.channels, opusFsPath)
            val encSuccess = encResult[0] as Boolean
            val encError = encResult[1] as String
            val encDuration = encResult[2] as Int
            val encWaveform = (encResult[3] as FloatArray).toList()
            var encPlaybackUri = ""
            if (encSuccess) {
              val m4aOk = PlatformAudioEncoder.encodePcmToM4a(
                pcm.samples, pcm.sampleRate, pcm.channels, m4aFsPath
              )
              if (m4aOk && java.io.File(m4aFsPath).length() > 0) encPlaybackUri = m4aFsPath
            }
            return@AsyncFunction mapOf(
              "success" to encSuccess,
              "error" to encError,
              "durationMs" to encDuration,
              "waveform" to encWaveform,
              "playbackUri" to encPlaybackUri
            )
          }
          return@AsyncFunction mapOf(
            "success" to false, "error" to "Unsupported audio format",
            "durationMs" to 0, "waveform" to emptyList<Float>(), "playbackUri" to ""
          )
        }

        if (success && maxDurationMs > 0 && durationMs > maxDurationMs) {
          java.io.File(opusFsPath).delete()
          return@AsyncFunction mapOf(
            "success" to false, "error" to "AUDIO_TOO_LONG",
            "durationMs" to durationMs, "waveform" to emptyList<Float>(), "playbackUri" to ""
          )
        }

        // Tier cap applies to the transcoded output, not the original input.
        if (success) {
          val outFile = java.io.File(opusFsPath)
          if (outFile.exists() && outFile.length() > outputCap) {
            outFile.delete()
            return@AsyncFunction mapOf(
              "success" to false, "error" to "FILE_TOO_LARGE",
              "durationMs" to durationMs, "waveform" to emptyList<Float>(), "playbackUri" to ""
            )
          }
        }

        // M4A playback copy from the same decode's PCM, no WAV intermediary.
        if (success && decodedPcm.isNotEmpty()) {
          PlatformAudioEncoder.encodePcmToM4a(decodedPcm, decodedRate, decodedChannels, m4aFsPath)
        }
        val playbackUri =
          if (success && java.io.File(m4aFsPath).exists() && java.io.File(m4aFsPath).length() > 0)
            m4aFsPath else ""

        return@AsyncFunction mapOf(
          "success" to success,
          "error" to error,
          "durationMs" to durationMs,
          "waveform" to waveform,
          "playbackUri" to playbackUri
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
        // capture for dictation/translation. Those effects are applied by the
        // source itself, so nothing is attached on top.
        //
        // Attaching them again used to be guarded by the belief that
        // isAvailable() reports false once the source already applies them. It
        // does not: it reports whether an implementation exists on the device,
        // which is true on essentially every handset. The result was two AEC,
        // NS and AGC instances in cascade, and the doubled NoiseSuppressor
        // gated dictation — short bursts separated by pauses — down toward the
        // noise floor. That survived playback (audible, just quiet) but not
        // amplitude-envelope rendering, which is what a voice note waveform is
        // drawn from. Effect state is now left entirely to the source.
        //
        // minSdkVersion is 24, so the MIC branch below is unreachable; it stays
        // only as a guard should that floor ever move.
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
        val captureLoop = PcmCaptureLoop("AudioRecord")
        val started = captureLoop.start(audioRecord!!, nativeOutputPath, isLive)
        if (!started) {
          Log.e("EkweAudio", "capture loop refused to start, rolling back")
          audioRecord?.release()
          audioRecord = null
          abandonAudioFocus()
          return@AsyncFunction mapOf("success" to false, "error" to "Capture start failed")
        }

        captureLoopRef = captureLoop
        isAudioRecording = true
        recordingStartedAt = System.currentTimeMillis()

        Log.d("EkweAudio", "startAudioRecording: recording started on $captureLoop")

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

    AsyncFunction("startOrbCapture") { outputPath: String, isLive: Boolean ->
      val activity = appContext.currentActivity
        ?: return@AsyncFunction mapOf("success" to false, "error" to "No foreground activity")
      if (!OrbConsent.request(activity, outputPath, isLive)) {
        return@AsyncFunction mapOf("success" to false, "error" to "Consent request failed")
      }
      mapOf("success" to true, "error" to "")
    }

    AsyncFunction("stopOrbCapture") {
      OrbConsent.stop(appContext.reactContext)
      mapOf("success" to true, "error" to "")
    }

    AsyncFunction("getOrbPeakAmplitude") {
      OrbCaptureService.lastPeakAmplitude.toDouble()
    }

    AsyncFunction("getRecordingAmplitude") { ->
      val amp = captureLoopRef?.amplitude ?: 0f
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

    AsyncFunction("resolveAudio") { inputPath: String, options: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "success" to false, "error" to "No context", "durationMs" to 0,
        "waveform" to emptyList<Float>(), "vorbisSuccess" to false
      )
      val opusArg = options["opusOutputPath"] as? String
      if (opusArg.isNullOrEmpty()) return@AsyncFunction mapOf(
        "success" to false, "error" to "missing opusOutputPath", "durationMs" to 0,
        "waveform" to emptyList<Float>(), "vorbisSuccess" to false
      )
      val opusOut = resolvePath(opusArg)
      val vorbisOut = (options["vorbisOutputPath"] as? String)?.let { resolvePath(it) }.orEmpty()
      val maxAudioBytes = sanitizeMaxAudioBytes((options["maxAudioBytes"] as? Number)?.toLong() ?: DEFAULT_MAX_AUDIO_BYTES)
      val maxDurationMs = (options["maxDurationMs"] as? Number)?.toLong()?.takeIf { it > 0 } ?: DEFAULT_MAX_DURATION_MS
      val inputFsPath = resolvePath(inputPath)

      try {
        val inputFile = java.io.File(inputFsPath)
        if (inputFile.length() > MAX_AUDIO_INPUT_BYTES) {
          return@AsyncFunction mapOf(
            "success" to false, "error" to "FILE_TOO_LARGE", "durationMs" to 0,
            "waveform" to emptyList<Float>(), "vorbisSuccess" to false
          )
        }

        val container = classifyAudioContainerJNI(inputFsPath)

        val originalDurationMs = gateDurationMs(context, inputFsPath, android.net.Uri.fromFile(inputFile))
        if (originalDurationMs != null && maxDurationMs > 0 && originalDurationMs > maxDurationMs) {
          return@AsyncFunction mapOf(
            "success" to false, "error" to "AUDIO_TOO_LONG", "durationMs" to clampDurationToInt(originalDurationMs),
            "waveform" to emptyList<Float>(), "vorbisSuccess" to false
          )
        }

        if (container == 1 || container == 2) {
          val result = resolveOggToArtifactsJNI(inputFsPath, opusOut, vorbisOut, maxAudioBytes)
          val success = result[0] as Boolean
          val error = result[1] as String
          val durationMs = result[2] as Int
          val waveform = (result[3] as FloatArray).toList()
          val vorbisSuccess = vorbisOut.isNotEmpty() && java.io.File(vorbisOut).let { it.exists() && it.length() > 0 }
          // Failsafe: enforce the limit on the authoritative decoded duration too.
          if (success && maxDurationMs > 0 && durationMs > maxDurationMs) {
            if (opusOut.isNotEmpty()) java.io.File(opusOut).delete()
            if (vorbisOut.isNotEmpty()) java.io.File(vorbisOut).delete()
            return@AsyncFunction mapOf(
              "success" to false, "error" to "AUDIO_TOO_LONG", "durationMs" to durationMs,
              "waveform" to emptyList<Float>(), "vorbisSuccess" to false
            )
          }
          return@AsyncFunction mapOf(
            "success" to success, "error" to error, "durationMs" to durationMs,
            "waveform" to waveform, "vorbisSuccess" to vorbisSuccess
          )
        }

        val pcm = PlatformAudioDecoder.decode(context, android.net.Uri.fromFile(inputFile), maxDurationMs)
          ?: return@AsyncFunction mapOf(
            "success" to false, "error" to "Unsupported audio format", "durationMs" to 0,
            "waveform" to emptyList<Float>(), "vorbisSuccess" to false
          )
        if (maxDurationMs > 0 && pcm.durationMs > maxDurationMs) {
          return@AsyncFunction mapOf(
            "success" to false, "error" to "AUDIO_TOO_LONG", "durationMs" to pcm.durationMs,
            "waveform" to emptyList<Float>(), "vorbisSuccess" to false
          )
        }

        val dual = encodePcmToDualJNI(pcm.samples, pcm.sampleRate, pcm.channels, opusOut, vorbisOut)
        val opus = dual[0]
        val vorbis = dual[1]
        return@AsyncFunction mapOf(
          "success" to (opus[0] as Boolean),
          "error" to (opus[1] as String),
          "durationMs" to (opus[2] as Int),
          "waveform" to (opus[3] as FloatArray).toList(),
          "vorbisSuccess" to (vorbis[0] as Boolean)
        )
      } catch (e: Exception) {
        Log.e("EkweNative", "resolveAudio failed", e)
        return@AsyncFunction mapOf(
          "success" to false, "error" to (e.message ?: "Unknown error"), "durationMs" to 0,
          "waveform" to emptyList<Float>(), "vorbisSuccess" to false
        )
      }
    }

    AsyncFunction("probeAudioDurationMs") { inputPath: String ->
      probeAudioDurationMsJNI(resolvePath(inputPath))
    }

    /**
     * Decodes the source and writes an M4A/AAC-LC playback copy at `outputPath`.
     * Ogg/WAV sources bridge through WAV; other containers decode via the
     * platform decoder then encode PCM to M4A. Returns true on success.
     */
    AsyncFunction("createPlaybackCopy") { inputPath: String, outputPath: String, maxAudioBytes: Long ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val inputFs = resolvePath(inputPath)
      val outputFs = resolvePath(outputPath)
      val inputFile = java.io.File(inputFs)
      if (!inputFile.isFile) return@AsyncFunction false
      val tempWav = "${outputFs.substringBeforeLast('.')}_wav.wav"
      try {
        val decoded = decodeFileToWavJNI(inputFs, tempWav, maxAudioBytes)
        if (decoded[0] as Boolean) {
          val ok = PlatformAudioEncoder.encodeWavToM4a(tempWav, outputFs)
          java.io.File(tempWav).delete()
          if (ok && java.io.File(outputFs).exists()) return@AsyncFunction true
        } else if ((decoded[1] as String) == "PLATFORM_DECODE_REQUIRED") {
          val pcm = PlatformAudioDecoder.decode(
            context, android.net.Uri.fromFile(inputFile), DEFAULT_MAX_DURATION_MS
          )
          if (pcm != null) {
            val ok = PlatformAudioEncoder.encodePcmToM4a(
              pcm.samples, pcm.sampleRate, pcm.channels, outputFs
            )
            if (ok && java.io.File(outputFs).exists()) return@AsyncFunction true
          }
        }
        java.io.File(tempWav).delete()
        false
      } catch (e: Exception) {
        Log.e("EkweNative", "createPlaybackCopy failed", e)
        java.io.File(tempWav).delete()
        false
      }
    }

    AsyncFunction("decodeAudioToWav") { inputPath: String, outputPath: String, maxAudioBytes: Long ->
      val inputFs = resolvePath(inputPath)
      val outputFs = resolvePath(outputPath)
      try {
        if (java.io.File(inputFs).length() > MAX_AUDIO_INPUT_BYTES) {
          return@AsyncFunction mapOf(
            "success" to false, "error" to "FILE_TOO_LARGE",
            "durationMs" to 0, "waveform" to emptyList<Float>()
          )
        }
        val result = decodeFileToWavJNI(inputFs, outputFs, maxAudioBytes)
        mapOf(
          "success" to (result[0] as Boolean),
          "error" to (result[1] as String),
          "durationMs" to (result[2] as Int),
          "waveform" to (result[3] as FloatArray).toList()
        )
      } catch (e: Exception) {
        Log.e("EkweNative", "decodeAudioToWav failed", e)
        mapOf(
          "success" to false, "error" to (e.message ?: "Unknown error"),
          "durationMs" to 0, "waveform" to emptyList<Float>()
        )
      }
    }

    // --- Audio Effects Methods ---
    AsyncFunction("attachEffects") { audioSessionId: Double ->
      val sessionId = audioSessionId.toInt()
      attachEffectsInternal(sessionId)
    }

    AsyncFunction("releaseEffects") { ->
      releaseEffectsInternal()
    }

    AsyncFunction("configureOrb") { config: Map<String, Any?> ->
      true
    }

    AsyncFunction("getOrbStatus") {
      mapOf("running" to false, "hasMediaProjection" to false, "foregroundApp" to null, "lastPeakAmplitude" to 0f)
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

  /**
   * Opt-in attachment of the platform AEC/NS/AGC to an arbitrary audio session.
   *
   * NOT used by the recorder. Capture runs on AudioSource.VOICE_COMMUNICATION,
   * which applies all three through the call-mode DSP already; attaching here
   * as well put two of each in cascade. Call this only for a session opened on
   * a source that does no processing of its own (e.g. MediaRecorder.AudioSource.MIC).
   */
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
   * Releases the capture loop + effects and stops the native capture controller.
   * Idempotent and callable from any thread, so both stopAudioRecording (JS
   * thread) and emitVadSilenceFromNative (C++ capture callback, which runs ON
   * the read loop) share one teardown path. PcmCaptureLoop.stop() skips the
   * join when called from its own read thread. Does NOT read
   * nativeGetLastWaveform(): that buffer is cleared on read, so
   * stopAudioRecording owns it exclusively.
   */
  private fun performStop() = synchronized(this) {
    isAudioRecording = false

    val loop = captureLoopRef
    captureLoopRef = null
    loop?.stop()

    audioRecord?.release()
    audioRecord = null

    releaseEffectsInternal()

    Log.d("EkweAudio", "performStop: capture loop stopped")
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
