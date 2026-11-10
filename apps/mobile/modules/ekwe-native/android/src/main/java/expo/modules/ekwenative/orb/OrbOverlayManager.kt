package expo.modules.ekwenative.orb

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.TextView
import expo.modules.ekwenative.R
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class OrbOverlayManager private constructor(private val context: Context) {
  private var windowManager: WindowManager? =
    context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
  private var bubbleView: View? = null
  private var isRecording = false
  private var resultText = ""
  private var liveTranscript = ""
  private var liveInterim = ""
  @Volatile
  var isStreaming = false
    private set
  @Volatile
  var streamState: String = "idle" // idle | connecting | listening | error
    private set
  @Volatile
  var streamError: String? = null
    private set
  @Volatile
  var silenceSuspected: Boolean = false
    private set
  @Volatile
  var detectedLanguage: String? = null
    private set
  private val mainHandler = Handler(Looper.getMainLooper())

  private var bubbleIcon: ImageView? = null
  private var recDot: View? = null
  private var badgeText: TextView? = null
  private var bubbleRoot: View? = null
  private var badgeDismissRunnable: Runnable? = null

  fun hasOverlayPermission(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Settings.canDrawOverlays(context)
    } else {
      true
    }

  fun requestOverlayPermission(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        android.net.Uri.parse("package:${activity.packageName}")
      )
      activity.startActivity(intent)
    }
  }

  private fun prefs() =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setEntitled(entitled: Boolean) {
    prefs().edit()
      .putBoolean(KEY_ENTITLED, entitled)
      .putLong(KEY_ENTITLED_AT, if (entitled) System.currentTimeMillis() else 0L)
      .apply()
  }

  fun hasEntitlement(): Boolean {
    val p = prefs()
    if (!p.getBoolean(KEY_ENTITLED, false)) return false
    val at = p.getLong(KEY_ENTITLED_AT, 0L)
    if (at <= 0L) return false
    return System.currentTimeMillis() - at <= ENTITLEMENT_TTL_MS
  }

  fun readPosition(): Pair<Int, Int> {
    val p = prefs()
    val density = context.resources.displayMetrics.density
    val defaultX = (16 * density).toInt()
    val defaultY = (160 * density).toInt()
    return p.getInt(KEY_BUBBLE_X, defaultX) to p.getInt(KEY_BUBBLE_Y, defaultY)
  }

  fun savePosition(x: Int, y: Int) {
    prefs().edit().putInt(KEY_BUBBLE_X, x).putInt(KEY_BUBBLE_Y, y).apply()
  }

  fun readHiddenByUser(): Boolean = prefs().getBoolean(KEY_HIDDEN_BY_USER, false)

  private fun setHiddenByUser(hidden: Boolean) {
    prefs().edit().putBoolean(KEY_HIDDEN_BY_USER, hidden).apply()
  }

  fun setResultText(text: String) {
    resultText = text
  }

  fun getResultText(): String = resultText

  fun setDetectedLanguage(lang: String?) {
    val normalized = lang?.trim()?.takeIf { it.isNotEmpty() }
    detectedLanguage = normalized
  }

  fun getDetectedLanguage(): String? = detectedLanguage

  fun setLiveTranscript(text: String, interim: String = "") {
    liveTranscript = text.trim()
    liveInterim = interim.trim()
    val combined = listOf(liveTranscript, liveInterim)
      .filter { it.isNotEmpty() }
      .joinToString(" ")
      .trim()
    if (combined.isNotEmpty()) resultText = combined
  }

  fun appendFinalTranscript(text: String, language: String? = null) {
    val t = text.trim()
    if (t.isNotEmpty()) {
      liveTranscript = if (liveTranscript.isBlank()) t else "${liveTranscript.trim()} $t"
    }
    if (!language.isNullOrBlank()) detectedLanguage = language.trim()
    liveInterim = ""
    if (liveTranscript.isNotBlank()) resultText = liveTranscript
  }

  fun setLiveInterim(text: String) {
    liveInterim = text.trim()
    val combined = listOf(liveTranscript.trim(), liveInterim)
      .filter { it.isNotEmpty() }
      .joinToString(" ")
      .trim()
    if (combined.isNotEmpty()) resultText = combined
  }

  fun clearLiveTranscript() {
    liveTranscript = ""
    liveInterim = ""
  }

  fun resetSessionState() {
    clearLiveTranscript()
    resultText = ""
    detectedLanguage = null
    streamError = null
    streamState = "idle"
    silenceSuspected = false
  }

  fun getLiveText(): String {
    val combined = listOf(liveTranscript.trim(), liveInterim.trim())
      .filter { it.isNotEmpty() }
      .joinToString(" ")
      .trim()
    return if (combined.isNotEmpty()) combined else resultText
  }

  fun getLiveFinal(): String = liveTranscript

  fun getLiveInterim(): String = liveInterim

  fun setStreaming(streaming: Boolean) {
    isStreaming = streaming
    if (!streaming && streamState != "error") {
      streamState = "idle"
    }
  }

  fun setStreamState(state: String, error: String? = null) {
    streamState = state
    streamError = error?.takeIf { it.isNotBlank() }
  }

  fun setSilenceSuspected(suspected: Boolean) {
    silenceSuspected = suspected
  }

  fun updateText(text: String) {
    val t = text.trim()
    if (t.isNotEmpty() && t != "…" && t != "...") {
      // Keep meaningful status/result hints; live transcript is the source of truth for text.
      if (t == "✓" || t == "error" || t == "Listening…") {
        // status-only markers handled by bubble state/text elsewhere as needed
      }
    }
    mainHandler.post {
      if (bubbleView == null) return@post
      val dot = recDot ?: return@post
      val badge = badgeText ?: return@post
      val kind = when {
        t.isEmpty() || t == "…" || t == "..." -> FeedbackKind.NONE
        t == "✓" || t.startsWith("✓") -> FeedbackKind.SUCCESS
        t.equals("error", ignoreCase = true) || t.equals("err", ignoreCase = true) -> FeedbackKind.ERROR
        else -> FeedbackKind.NONE
      }
      when (kind) {
        FeedbackKind.NONE -> hideBadge()
        FeedbackKind.SUCCESS -> showBadge("✓", success = true)
        FeedbackKind.ERROR -> showBadge("!", success = false)
      }
      applyRecordingUi(dot, recording = isRecording || isStreaming)
    }
  }

  fun show(orbEnabled: Boolean) {
    if (!orbEnabled) {
      hide()
      return
    }
    if (readHiddenByUser() && !OrbCaptureService.isRunning) {
      hide()
      return
    }
    if (!hasOverlayPermission()) {
      return
    }
    if (bubbleView != null) {
      updateBubbleState()
      return
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    )
    val (savedX, savedY) = readPosition()
    params.gravity = Gravity.TOP or Gravity.START
    params.x = savedX
    params.y = savedY

    val view = LayoutInflater.from(context).inflate(R.layout.orb_bubble, null)
    view.setOnClickListener {
      if (System.currentTimeMillis() - lastDragAtMs < 350L) return@setOnClickListener
      runCatching {
        context.startActivity(Intent(context, OrbPanelActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
      }
    }
    setupDrag(view, params)
    bubbleIcon = view.findViewById(R.id.orb_bubble_icon)
    recDot = view.findViewById(R.id.orb_rec_dot)
    badgeText = view.findViewById(R.id.orb_bubble_badge)
    bubbleRoot = view.findViewById(R.id.orb_bubble_root)
    bubbleView = view
    updateBubbleState()

    runCatching { windowManager?.addView(view, params) }
      .onFailure { Log.e(TAG, "Failed to show bubble", it) }
  }

  fun hide() {
    bubbleView?.let {
      runCatching { windowManager?.removeView(it) }
    }
    bubbleView = null
    bubbleIcon = null
    recDot = null
    badgeText = null
    bubbleRoot = null
    badgeDismissRunnable = null
    isRecording = false
    isStreaming = false
    streamState = "idle"
    streamError = null
    silenceSuspected = false
  }

  fun setRecording(recording: Boolean) {
    isRecording = recording
    updateBubbleState()
  }

  private fun updateBubbleState() {
    mainHandler.post {
      val dot = recDot ?: return@post
      applyRecordingUi(dot, recording = isRecording || isStreaming)
    }
  }

  private fun applyRecordingUi(dot: View, recording: Boolean) {
    if (recording) {
      bubbleIcon?.visibility = View.GONE
      dot.visibility = View.VISIBLE
    } else {
      dot.visibility = View.GONE
      if (badgeText?.visibility != View.VISIBLE) {
        bubbleIcon?.visibility = View.VISIBLE
      }
    }
  }

  private fun showBadge(text: String, success: Boolean) {
    val badge = badgeText ?: return
    badge.text = text
    val bg = (badge.background as? GradientDrawable)
      ?: GradientDrawable().also { badge.background = it }
    bg.shape = GradientDrawable.OVAL
    bg.setColor(if (success) 0xFF34C759.toInt() else 0xFFFF3B30.toInt())
    badge.visibility = View.VISIBLE
    bubbleIcon?.visibility = View.GONE
    badgeDismissRunnable?.let { mainHandler.removeCallbacks(it) }
    val dismiss = Runnable { hideBadge() }
    badgeDismissRunnable = dismiss
    mainHandler.postDelayed(dismiss, 3000L)
  }

  private fun hideBadge() {
    badgeDismissRunnable?.let { mainHandler.removeCallbacks(it) }
    badgeDismissRunnable = null
    badgeText?.visibility = View.GONE
    if (isRecording || isStreaming) {
      bubbleIcon?.visibility = View.GONE
      recDot?.visibility = View.VISIBLE
    } else {
      bubbleIcon?.visibility = View.VISIBLE
    }
  }

  @Volatile
  private var lastDragAtMs = 0L

  private fun setupDrag(view: View, params: WindowManager.LayoutParams) {
    var initialX = 0
    var initialY = 0
    var initialTouchX = 0f
    var initialTouchY = 0f
    var isDragging = false

    view.setOnTouchListener { v, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          isDragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - initialTouchX
          val dy = event.rawY - initialTouchY
          if (!isDragging && (abs(dx) > 10 || abs(dy) > 10)) {
            isDragging = true
          }
          if (isDragging) {
            params.x = initialX + dx.toInt()
            params.y = initialY + dy.toInt()
            runCatching { windowManager?.updateViewLayout(v, params) }
            val screenH = context.resources.displayMetrics.heightPixels
            val hideZonePx = TypedValue.applyDimension(
              TypedValue.COMPLEX_UNIT_DIP, 72f, context.resources.displayMetrics
            ).toInt()
            val inHideZone = params.y > screenH - hideZonePx - (v.height.takeIf { it > 0 } ?: 0)
            val root = bubbleRoot ?: v
            if (inHideZone) {
              root.alpha = 0.45f
              root.scaleX = 0.8f
              root.scaleY = 0.8f
            } else {
              root.alpha = 1f
              root.scaleX = 1f
              root.scaleY = 1f
            }
          }
          true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          if (isDragging) {
            lastDragAtMs = System.currentTimeMillis()
            val screenW = context.resources.displayMetrics.widthPixels
            val screenH = context.resources.displayMetrics.heightPixels
            val vW = v.width.takeIf { it > 0 } ?: 1
            val vH = v.height.takeIf { it > 0 } ?: 1
            val hideZonePx = TypedValue.applyDimension(
              TypedValue.COMPLEX_UNIT_DIP, 72f, context.resources.displayMetrics
            ).toInt()
            val inHideZone = params.y > screenH - hideZonePx - vH
            if (inHideZone) {
              setHiddenByUser(true)
              hide()
            } else {
              val snapX = if (params.x + vW / 2 < screenW / 2) 0 else (screenW - vW)
              params.x = max(0, min(snapX, screenW - vW))
              params.y = max(0, min(params.y, screenH - vH))
              runCatching { windowManager?.updateViewLayout(v, params) }
              savePosition(params.x, params.y)
              (bubbleRoot ?: v).alpha = 1f
              (bubbleRoot ?: v).scaleX = 1f
              (bubbleRoot ?: v).scaleY = 1f
            }
          }
          isDragging = false
          if (!isDragging) {
            v.performClick()
          }
          true
        }
        else -> false
      }
    }
  }

  private enum class FeedbackKind { NONE, SUCCESS, ERROR }

  companion object {
    private const val TAG = "EkweOrb"
    private const val PREFS = "ekwe_orb"
    private const val KEY_BUBBLE_X = "bubble_x"
    private const val KEY_BUBBLE_Y = "bubble_y"
    private const val KEY_HIDDEN_BY_USER = "hidden_by_user"
    private const val KEY_ENTITLED = "entitled"
    private const val KEY_ENTITLED_AT = "entitled_at"
    private const val ENTITLEMENT_TTL_MS = 24L * 60L * 60L * 1000L

    @Volatile
    private var instance: OrbOverlayManager? = null

    fun getInstance(context: Context): OrbOverlayManager =
      instance ?: synchronized(this) {
        instance ?: OrbOverlayManager(context.applicationContext).also { instance = it }
      }
  }
}
