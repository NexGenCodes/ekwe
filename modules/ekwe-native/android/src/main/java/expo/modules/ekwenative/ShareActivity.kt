package expo.modules.ekwenative

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
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

/**
 * ShareActivity — Instant-boot translucent overlay.
 * 
 * 1. Shows a native loading card INSTANTLY in onCreate()
 * 2. Passes the raw content:// URI directly to React Native as a prop
 * 3. React Native resolves it asynchronously via EkweNative.resolveContentUri()
 * 
 * No native file I/O occurs here — the entire pipeline runs in the JS thread
 * after the UI is already interactive.
 */
class ShareActivity : ReactActivity() {

    companion object {
        private const val TAG = "ShareActivity"
        @Volatile
        var nativeLoaderView: View? = null
    }

    override fun getMainComponentName(): String = "share-extension"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        val defaultDelegate = object : DefaultReactActivityDelegate(this, "share-extension", fabricEnabled) {
            override fun getLaunchOptions(): Bundle {
                val bundle = Bundle()
                intent?.let { extractInitialMetadata(it, bundle) }
                return bundle
            }
        }

        return try {
            val wrapperClass = Class.forName("expo.modules.ReactActivityDelegateWrapper")
            val constructor = wrapperClass.getConstructor(
                ReactActivity::class.java,
                Boolean::class.java,
                ReactActivityDelegate::class.java
            )
            constructor.newInstance(this, fabricEnabled, defaultDelegate) as ReactActivityDelegate
        } catch (e: Exception) {
            Log.e(TAG, "Failed to instantiate ReactActivityDelegateWrapper via reflection", e)
            defaultDelegate
        }
    }

    private fun extractInitialMetadata(intent: Intent, bundle: Bundle) {
        if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
            val sourceApp = referrer?.host
                ?: intent.getStringExtra(Intent.EXTRA_REFERRER_NAME)
                ?: "Unknown App"
            bundle.putString("sourceApp", sourceApp)

            val streamUri = if (intent.action == Intent.ACTION_SEND) {
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.firstOrNull()
            } else null

            if (streamUri != null) {
                bundle.putString("audioUri", streamUri.toString())
                val mimeType = contentResolver.getType(streamUri) ?: "audio/mpeg"
                bundle.putString("mimeType", mimeType)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        wipeOrphanedCacheFiles()
        super.onCreate(null)
        showNativeLoadingCard()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.let {
            val bundle = Bundle()
            extractInitialMetadata(it, bundle)
            try {
                reactDelegate?.reactRootView?.appProperties = bundle
                Log.d(TAG, "onNewIntent: Injected new props into ReactRootView")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to update ReactRootView props", e)
            }
        }
    }

    override fun onDestroy() {
        wipeOrphanedCacheFiles()
        dismissNativeLoader()
        sendBubbleCommand("com.ekwe.LENS_SHOW")
        super.onDestroy()
    }

    // ── Native Loader UI ──────────────────────────────────────────────────

    private fun showNativeLoadingCard() {
        val dp = { value: Int ->
            TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
        }

        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(120, 0, 0, 0))
            isClickable = true
        }

        val isDark = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val bgHex = if (isDark) "#18181B" else "#FFFFFF"
        val handleHex = if (isDark) "#3F3F46" else "#E4E4E7"

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.parseColor(bgHex))
                cornerRadii = floatArrayOf(dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), dp(24).toFloat(), 0f, 0f, 0f, 0f)
            }
            setPadding(dp(24), dp(20), dp(24), dp(40))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        // Drag handle
        card.addView(View(this).apply {
            background = GradientDrawable().apply { setColor(Color.parseColor(handleHex)); cornerRadius = dp(2).toFloat() }
        }, LinearLayout.LayoutParams(dp(40), dp(4)).apply { bottomMargin = dp(20); gravity = Gravity.CENTER_HORIZONTAL })

        // Label
        card.addView(TextView(this).apply {
            text = "Ekwe Echo"
            setTextColor(Color.parseColor("#A1A1AA"))
            textSize = 10f
            letterSpacing = 0.15f
            isAllCaps = true
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16); gravity = Gravity.START })

        // Pulse Animation
        val pulseContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(80)).apply { bottomMargin = dp(24); gravity = Gravity.CENTER_HORIZONTAL }
        }
        val pulseRing = View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(2), Color.parseColor("#1A7EC8")) }
            layoutParams = FrameLayout.LayoutParams(dp(60), dp(60)).apply { gravity = Gravity.CENTER }
        }
        pulseContainer.addView(pulseRing)
        pulseContainer.addView(View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#1A7EC8")) }
            layoutParams = FrameLayout.LayoutParams(dp(16), dp(16)).apply { gravity = Gravity.CENTER }
        })
        card.addView(pulseContainer)

        val scaleX = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleX", 0.6f, 1.2f, 0.6f).apply { repeatCount = -1 }
        val scaleY = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleY", 0.6f, 1.2f, 0.6f).apply { repeatCount = -1 }
        val fade = android.animation.ObjectAnimator.ofFloat(pulseRing, "alpha", 1f, 0.2f, 1f).apply { repeatCount = -1 }
        android.animation.AnimatorSet().apply { playTogether(scaleX, scaleY, fade); duration = 1800L; start() }

        card.addView(TextView(this).apply {
            text = "Preparing voice note..."
            setTextColor(if (isDark) Color.parseColor("#FAFAFA") else Color.parseColor("#18181B"))
            textSize = 14f
            gravity = Gravity.CENTER
        })

        scrim.addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.BOTTOM })
        addContentView(scrim, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        nativeLoaderView = scrim
    }

    fun dismissNativeLoader() {
        nativeLoaderView?.let { view ->
            try { (view.parent as? ViewGroup)?.removeView(view) } catch (e: Exception) { Log.w(TAG, "Failed loader removal", e) }
            nativeLoaderView = null
        }
    }

    private fun wipeOrphanedCacheFiles() {
        Thread {
            try {
                cacheDir.listFiles()?.forEach { file ->
                    if (file.name.startsWith("shared_voice_")) {
                        file.delete()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed cache wipe", e)
            }
        }.start()
    }

    private fun sendBubbleCommand(action: String) {
        try {
            val intent = Intent(this, BubbleService::class.java).apply { this.action = action }
            startService(intent)
        } catch (e: Exception) {}
    }
}

