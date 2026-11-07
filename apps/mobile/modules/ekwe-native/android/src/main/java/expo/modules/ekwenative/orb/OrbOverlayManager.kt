package expo.modules.ekwenative.orb

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import expo.modules.ekwenative.EchoDesignTokens
import expo.modules.ekwenative.R
import kotlin.math.abs

class OrbOverlayManager private constructor(private val context: Context) {
  private var windowManager: WindowManager? =
    context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
  private var bubbleView: View? = null
  private var isExpanded = false
  private var isRecording = false
  private val mainHandler = Handler(Looper.getMainLooper())

  companion object {
    private const val TAG = "OrbOverlayManager"

    @Volatile
    private var instance: OrbOverlayManager? = null

    fun getInstance(context: Context): OrbOverlayManager {
      return instance ?: synchronized(this) {
        instance ?: OrbOverlayManager(context.applicationContext).also { instance = it }
      }
    }
  }

  fun setEnabled(enabled: Boolean) {
    mainHandler.post {
      if (enabled) {
        showBubble()
      } else {
        hide()
      }
    }
  }

  fun setRecording(recording: Boolean) {
    mainHandler.post {
      isRecording = recording
      updateStateVisuals()
    }
  }

  fun updateText(text: String) {
    mainHandler.post {
      val view = bubbleView ?: return@post
      val tv = view.findViewById<TextView>(R.id.orbText) ?: return@post
      val bg = view.findViewById<View>(R.id.orbBubble) ?: return@post

      if (text == "error") {
        tv.text = "!"
        bg.backgroundTintList = ColorStateList.valueOf(
          EchoDesignTokens.Semantic.error.light
        )
        mainHandler.postDelayed({ updateStateVisuals() }, 3000)
      } else if (text.isNotBlank()) {
        tv.text = "✓"
        bg.backgroundTintList = ColorStateList.valueOf(
          EchoDesignTokens.Semantic.success.light
        )
        mainHandler.postDelayed({ updateStateVisuals() }, 3000)
      } else {
        updateStateVisuals()
      }
    }
  }

  fun showBubble() {
    if (bubbleView != null) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
      Log.w(TAG, "Cannot show bubble: overlay permission not granted")
      return
    }

    try {
      val layoutParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
          WindowManager.LayoutParams.TYPE_PHONE
        },
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      )
      layoutParams.gravity = Gravity.TOP or Gravity.END
      layoutParams.x = 40
      layoutParams.y = 240

      val inflater = LayoutInflater.from(context)
      val view = inflater.inflate(R.layout.orb_bubble, null)
      applyTokens(view)

      var initialX = 0
      var initialY = 0
      var initialTouchX = 0f
      var initialTouchY = 0f
      var isMoving = false

      view.setOnTouchListener { v, event ->
        when (event.action) {
          MotionEvent.ACTION_DOWN -> {
            initialX = layoutParams.x
            initialY = layoutParams.y
            initialTouchX = event.rawX
            initialTouchY = event.rawY
            isMoving = false
            true
          }
          MotionEvent.ACTION_MOVE -> {
            val dx = (initialTouchX - event.rawX).toInt()
            val dy = (event.rawY - initialTouchY).toInt()
            if (abs(dx) > 10 || abs(dy) > 10) {
              isMoving = true
            }
            layoutParams.x = initialX + dx
            layoutParams.y = initialY + dy
            runCatching { windowManager?.updateViewLayout(view, layoutParams) }
            true
          }
          MotionEvent.ACTION_UP -> {
            if (!isMoving) {
              v.performClick()
            }
            true
          }
          else -> false
        }
      }

      view.setOnClickListener {
        handleBubbleClick()
      }

      windowManager?.addView(view, layoutParams)
      bubbleView = view
      updateStateVisuals()
    } catch (e: Exception) {
      Log.e(TAG, "Failed to show bubble", e)
    }
  }

  private fun handleBubbleClick() {
    if (OrbCaptureService.isRunning) {
      // Tapping during capture stops recording
      OrbConsent.stop(context)
      isRecording = false
    } else {
      val pm = context.packageManager
      val launchIntent = pm.getLaunchIntentForPackage(context.packageName)?.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra("orb_action", "start_capture")
      }
      if (launchIntent != null) {
        context.startActivity(launchIntent)
      }
    }
    updateStateVisuals()
  }

  private fun updateStateVisuals() {
    val view = bubbleView ?: return
    val text = view.findViewById<TextView>(R.id.orbText) ?: return
    val bg = view.findViewById<View>(R.id.orbBubble) ?: return

    if (OrbCaptureService.isRunning || isRecording) {
      text.text = "●"
      bg.backgroundTintList = ColorStateList.valueOf(
        EchoDesignTokens.Semantic.error.light
      )
    } else {
      text.text = if (isExpanded) "Orb" else "•"
      bg.backgroundTintList = ColorStateList.valueOf(
        EchoDesignTokens.Semantic.brand.light
      )
    }
  }

  private fun applyTokens(view: View) {
    val bg = view.findViewById<View>(R.id.orbBubble)
    bg?.backgroundTintList = ColorStateList.valueOf(
      EchoDesignTokens.Semantic.brand.light
    )
  }

  fun hide() {
    bubbleView?.let {
      runCatching { windowManager?.removeView(it) }
    }
    bubbleView = null
    isExpanded = false
    isRecording = false
  }
}
