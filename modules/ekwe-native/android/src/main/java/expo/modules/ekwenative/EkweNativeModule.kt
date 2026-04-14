package expo.modules.ekwenative

import android.content.Context
import android.content.Intent
import android.provider.OpenableColumns
import android.provider.Settings
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

import android.media.audiofx.NoiseSuppressor
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.util.Log

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  companion object {
    var instance: EkweNativeModule? = null
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
      // Dismiss native loader first, then finish
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
        // Detect the real MIME type from ContentResolver
        val mimeType = context.contentResolver.getType(uri) ?: "audio/ogg"
        
        // Get the real file extension from MIME or fallback to original name
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
            ?: getExtensionFromContentUri(context, uri)
            ?: "opus" // WhatsApp default
        
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

    AsyncFunction("isAccessibilityEnabled") { ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val enabledServices = Settings.Secure.getString(
          context.contentResolver, 
          Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
      ) ?: ""
      val serviceName = "${context.packageName}/${EkweAccessibilityService::class.java.canonicalName}"
      enabledServices.contains(serviceName)
    }

    AsyncFunction("requestAccessibilityPermission") { ->
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      appContext.reactContext?.startActivity(intent)
    }

    // --- System Audio Capture ---
    AsyncFunction("requestMediaProjection") { ->
      val intent = Intent(appContext.reactContext, MediaProjectionActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      appContext.reactContext?.startActivity(intent)
    }

    AsyncFunction("stopAudioCapture") { ->
      val intent = Intent(appContext.reactContext, AudioCaptureService::class.java).apply {
        action = AudioCaptureService.ACTION_STOP
      }
      appContext.reactContext?.startService(intent)
    }

    // --- Audio Effects Methods ---
    AsyncFunction("attachEffects") { audioSessionId: Double ->
      val sessionId = audioSessionId.toInt()
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
      return@AsyncFunction result
    }

    AsyncFunction("releaseEffects") { ->
      noiseSuppressor?.release()
      echoCanceler?.release()
      gainControl?.release()
      noiseSuppressor = null
      echoCanceler = null
      gainControl = null
      Unit
    }
  }

  /**
   * Extracts file extension from the content URI's display name.
   * E.g., "AUD-20260412-WA0003.opus" → "opus"
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
