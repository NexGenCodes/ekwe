package expo.modules.ekwenative

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

import android.media.audiofx.NoiseSuppressor
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.os.Process
import android.os.Build
import android.accessibilityservice.AccessibilityService
import expo.modules.kotlin.events.EventEmitter

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  companion object {
    var instance: EkweNativeModule? = null

    /**
     * Safe helper for Background Services to emit events to JS.
     * Called from BubbleService when lifecycle state changes.
     */
    fun emitBubbleEvent(state: String, data: Map<String, Any?>? = null) {
      instance?.let { module ->
        try {
          val payload = mutableMapOf<String, Any?>("state" to state)
          data?.let { payload.putAll(it) }
          module.sendEvent("onBubbleStateChanged", payload)
        } catch (e: Exception) {
          android.util.Log.w("EkweNative", "Failed to emit bubble event: $state", e)
        }
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

    Events("onForegroundAppChanged", "onBubbleStateChanged")

    // --- Accessibility & App Detection ---

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

    // --- Bubble Overlay Methods ---

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

    AsyncFunction("startBubbleService") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_START
      }
      appContext.reactContext?.startForegroundService(intent)
    }

    AsyncFunction("stopBubbleService") { ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_STOP
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("updateBubbleVisibility") { visible: Boolean ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_UPDATE_VISIBILITY
        putExtra("visible", visible)
      }
      appContext.reactContext?.startService(intent)
    }

    OnActivityEntersForeground {
      // PRO-GRADE EXCLUSIVITY: Kill the bubble service the moment the app becomes active
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_STOP
      }
      appContext.reactContext?.startService(intent)
      // SYNC: Notify JS so the store doesn't stay stuck in 'bubble' mode
      emitBubbleEvent("STOPPED", mapOf("reason" to "foreground_exclusivity"))
    }

    AsyncFunction("updateBubbleState") { mode: String, data: String? ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_UPDATE_STATE
        putExtra("mode", mode)
        putExtra("data", data)
      }
      appContext.reactContext?.startService(intent)
    }

    AsyncFunction("showFloatingCard") { transcription: String, translation: String ->
      val intent = Intent(appContext.reactContext, BubbleService::class.java).apply {
        action = BubbleService.ACTION_SHOW_CARD
        putExtra("transcription", transcription)
        putExtra("translation", translation)
      }
      appContext.reactContext?.startForegroundService(intent)
    }

    AsyncFunction("resolveContentUri") { uriString: String ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      val uri = android.net.Uri.parse(uriString)
      
      if (uri.scheme != "content") return@AsyncFunction uriString

      try {
        val fileName = "shared_voice_${System.currentTimeMillis()}.m4a"
        val cacheFile = java.io.File(context.cacheDir, fileName)
        
        context.contentResolver.openInputStream(uri)?.use { input ->
          java.io.FileOutputStream(cacheFile).use { output ->
            input.copyTo(output)
          }
        }
        return@AsyncFunction "file://${cacheFile.absolutePath}"
      } catch (e: Exception) {
        android.util.Log.e("EkweNative", "Failed to resolve content URI", e)
        return@AsyncFunction null
      }
    }

    AsyncFunction("getSavedPosition") { ->
      val prefs = appContext.reactContext?.getSharedPreferences(
        "ekwe_bubble", Context.MODE_PRIVATE
      )
      val x = prefs?.getFloat("bubble_x", -1f) ?: -1f
      val y = prefs?.getFloat("bubble_y", -1f) ?: -1f
      
      if (x < 0 || y < 0) {
        null
      } else {
        mapOf(
          "x" to x.toDouble(),
          "y" to y.toDouble()
        )
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

    // --- System Audio Capture (Loopback) ---
    
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
}
