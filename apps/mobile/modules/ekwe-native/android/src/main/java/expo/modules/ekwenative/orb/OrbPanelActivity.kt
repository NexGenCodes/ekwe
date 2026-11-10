package expo.modules.ekwenative.orb

import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ekwenative.EchoDesignTokens

/**
 * OrbPanelActivity — translucent React Activity hosting the RN OrbPanel.
 * Mirrors ShareActivity: same bundle, same translucent overlay pattern, so the
 * panel gets the full design system including the Voice Studio language picker.
 * The bubble stays native; tapping it opens this activity, which floats the
 * panel over the source app without opening the main app UI.
 */
class OrbPanelActivity : ReactActivity() {
  companion object {
    private const val TAG = "OrbPanelActivity"

    @Volatile
    var nativeLoaderView: View? = null
  }

  override fun getMainComponentName(): String = "orb-panel"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    val defaultDelegate = object : DefaultReactActivityDelegate(this, "orb-panel", fabricEnabled) {
      override fun getLaunchOptions(): Bundle? = null
    }

    return try {
      val wrapperClass = Class.forName("expo.modules.ReactActivityDelegateWrapper")
      val constructor = wrapperClass.getConstructor(
        ReactActivity::class.java,
        Boolean::class.java,
        ReactActivityDelegate::class.java,
      )
      constructor.newInstance(this, fabricEnabled, defaultDelegate) as ReactActivityDelegate
    } catch (e: Exception) {
      Log.e(TAG, "Failed to instantiate ReactActivityDelegateWrapper via reflection", e)
      defaultDelegate
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    showNativeLoadingCard()
    scheduleLoaderTimeout()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    showNativeLoadingCard()
    scheduleLoaderTimeout()
  }

  private fun scheduleLoaderTimeout() {
    window?.decorView?.removeCallbacks(timeoutDismiss)
    window?.decorView?.postDelayed(timeoutDismiss, 8000)
  }

  private val timeoutDismiss = Runnable { dismissNativeLoader() }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    if (nativeLoaderView != null) {
      showNativeLoadingCard()
    }
  }

  override fun onDestroy() {
    dismissNativeLoader()
    super.onDestroy()
  }

  fun dismissNativeLoader() {
    runCatching { window?.decorView?.removeCallbacks(timeoutDismiss) }
    nativeLoaderView?.let { view ->
      runCatching { (view.parent as? ViewGroup)?.removeView(view) }
      nativeLoaderView = null
    }
  }

  private fun showNativeLoadingCard() {
    dismissNativeLoader()
    val dp = { value: Int ->
      TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
    }
    val isDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val scrimColor = EchoDesignTokens.Semantic.overlay.color(isDark)
    val cardColor = EchoDesignTokens.Semantic.card.color(isDark)
    val pulseColor = EchoDesignTokens.Semantic.brand.color(isDark)
    val textColor = EchoDesignTokens.Semantic.foreground.color(isDark)

    val scrim = FrameLayout(this).apply {
      setBackgroundColor(scrimColor)
      isClickable = true
    }
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = GradientDrawable().apply {
        setColor(cardColor)
        cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
      }
      setPadding(dp(24), dp(28), dp(24), dp(48))
      gravity = Gravity.CENTER_HORIZONTAL
    }
    val pill = View(this).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(pulseColor) }
      layoutParams = FrameLayout.LayoutParams(dp(56), dp(56)).apply { gravity = Gravity.CENTER }
    }
    card.addView(pill, LinearLayout.LayoutParams(dp(56), dp(56)).apply { bottomMargin = dp(20); gravity = Gravity.CENTER_HORIZONTAL })
    card.addView(TextView(this).apply {
      text = "Ekwe Orb"
      setTextColor(textColor)
      textSize = 14f
      gravity = Gravity.CENTER
    })
    scrim.addView(card, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.BOTTOM })
    addContentView(scrim, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    nativeLoaderView = scrim
  }
}
