package expo.modules.ekwenative

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

import android.media.audiofx.NoiseSuppressor
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl

class EkweNativeModule : Module() {
  private var noiseSuppressor: NoiseSuppressor? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var gainControl: AutomaticGainControl? = null

  override fun definition() = ModuleDefinition {
    
    Name("EkweNative")

    // --- Bubble Overlay Methods ---

    AsyncFunction("hasOverlayPermission") { ->
      Settings.canDrawOverlays(appContext.reactContext)
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
    }
  }
}
