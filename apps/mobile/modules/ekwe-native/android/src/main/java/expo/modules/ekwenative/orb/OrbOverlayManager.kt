package expo.modules.ekwenative.orb

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import expo.modules.ekwenative.R
import expo.modules.ekwenative.EchoDesignTokens

class OrbOverlayManager(private val context: Context) {
  private var windowManager: WindowManager? = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
  private var bubbleView: View? = null
  private var expanded = false

  fun showBubble() {
    if (bubbleView != null) return
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
    view.setOnClickListener {
      expanded = !expanded
      updateExpanded(view)
    }
    windowManager?.addView(view, layoutParams)
    bubbleView = view
  }

  private fun updateExpanded(view: View) {
    val text = view.findViewById<TextView>(R.id.orbText)
    text.text = if (expanded) "Orb" else "•"
  }

  private fun applyTokens(view: View) {
    val bg = view.findViewById<View>(R.id.orbBubble)
    bg.backgroundTintList = android.content.res.ColorStateList.valueOf(
      EchoDesignTokens.Semantic.brand.light
    )
  }

  fun hide() {
    bubbleView?.let { windowManager?.removeView(it) }
    bubbleView = null
  }
}