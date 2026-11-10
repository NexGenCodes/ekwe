package expo.modules.ekwenative.orb

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log

object OrbConsent {
  private const val REQUEST_CODE = 7041
  private const val TAG = "EkweOrb"

  private var outputPath = ""
  private var isLive = true
  private var streamEnabled = false
  private var streamWsUrl: String? = null
  private var streamToken: String? = null
  private var streamLang: String = "en"

  fun setPending(
    path: String,
    live: Boolean,
    stream: Boolean = false,
    wsUrl: String? = null,
    token: String? = null,
    lang: String = "en",
  ) {
    outputPath = path
    isLive = live
    streamEnabled = stream
    streamWsUrl = wsUrl
    streamToken = token
    streamLang = lang
  }

  fun request(
    activity: Activity,
    path: String,
    live: Boolean,
    stream: Boolean = false,
    wsUrl: String? = null,
    token: String? = null,
    lang: String = "en",
  ): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val manager =
      activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    outputPath = path
    isLive = live
    streamEnabled = stream
    streamWsUrl = wsUrl
    streamToken = token
    streamLang = lang
    return try {
      activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE)
      true
    } catch (e: Exception) {
      Log.e(TAG, "consent request failed", e)
      false
    }
  }

  fun accepts(requestCode: Int): Boolean = requestCode == REQUEST_CODE

  fun start(context: Context, resultCode: Int, data: Intent?) {
    if (data == null) {
      Log.e(TAG, "no consent token")
      return
    }
    context.startForegroundService(
      Intent(context, OrbCaptureService::class.java).apply {
        action = OrbCaptureService.ACTION_START
        putExtra(OrbCaptureService.EXTRA_RESULT_CODE, resultCode)
        putExtra(OrbCaptureService.EXTRA_RESULT_DATA, data)
        putExtra(OrbCaptureService.EXTRA_OUTPUT_PATH, outputPath)
        putExtra(OrbCaptureService.EXTRA_IS_LIVE, isLive)
        putExtra(OrbCaptureService.EXTRA_STREAM_ENABLED, streamEnabled)
        putExtra(OrbCaptureService.EXTRA_STREAM_WS_URL, streamWsUrl)
        putExtra(OrbCaptureService.EXTRA_STREAM_TOKEN, streamToken)
        putExtra(OrbCaptureService.EXTRA_STREAM_LANG, streamLang)
      }
    )
  }

  fun stop(context: Context?) {
    val target = context ?: return
    target.startService(
      Intent(target, OrbCaptureService::class.java).apply {
        action = OrbCaptureService.ACTION_STOP
      }
    )
  }
}