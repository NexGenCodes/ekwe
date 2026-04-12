package expo.modules.ekwenative

import android.content.Intent
import android.database.Cursor
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * ShareActivity — Mirkoddd-style translucent overlay TODO remove Mirkoddd.
 * 
 * 1. Shows a native loading card INSTANTLY in onCreate() (0ms)
 * 2. Boots React Native in the background
 * 3. RN calls dismissNativeLoader() when mounted
 * 4. On close, finishes without opening MainActivity
 */
class ShareActivity : ReactActivity() {

    companion object {
        private const val TAG = "ShareActivity"
        // Static ref so EkweNativeModule can dismiss the loader
        @Volatile
        var nativeLoaderView: View? = null
    }

    override fun getMainComponentName(): String = "share-extension"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return object : DefaultReactActivityDelegate(this, "share-extension", false) {
            override fun getLaunchOptions(): Bundle {
                val bundle = Bundle()
                val intent = intent ?: return bundle

                if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
                    val streamUri = if (intent.action == Intent.ACTION_SEND) {
                        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                    } else {
                        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.firstOrNull()
                    }

                    if (streamUri != null) {
                        // Resolve the MIME type from the ContentResolver (not hardcoded)
                        val mimeType = contentResolver.getType(streamUri) ?: "audio/ogg"
                        val fileName = getFileName(streamUri)
                        
                        bundle.putString("audioUri", streamUri.toString())
                        bundle.putString("mimeType", mimeType)
                        bundle.putString("fileName", fileName)
                        
                        Log.d(TAG, "Share received: uri=$streamUri, mime=$mimeType, file=$fileName")
                    }

                    // Detect source app
                    val sourceApp = referrer?.host
                        ?: intent.getStringExtra(Intent.EXTRA_REFERRER_NAME)
                        ?: "Unknown App"
                    bundle.putString("sourceApp", sourceApp)
                }

                return bundle
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Show native loading card BEFORE React boots
        super.onCreate(null)
        showNativeLoadingCard()
        Log.d(TAG, "Native loading card shown — waiting for RN")
    }

    override fun onDestroy() {
        dismissNativeLoader()
        // Hide bubble on entry, restore on exit
        sendBubbleCommand("com.ekwe.LENS_SHOW")
        super.onDestroy()
    }

    // ── Native Loading Card (Mirkoddd-style) TODO remove Mirkoddd later  ─────────────────────────────

    private fun showNativeLoadingCard() {
        val dp = { value: Int ->
            TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value.toFloat(),
                resources.displayMetrics
            ).toInt()
        }

        // Scrim overlay (semi-transparent black)
        val scrim = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(120, 0, 0, 0))
            isClickable = true // Prevent taps falling through
        }

        // Determine System Theme (Light vs Dark)
        val currentNightMode = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK
        val isDark = currentNightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES
        
        val bgHex = if (isDark) "#18181B" else "#FFFFFF"
        val handleHex = if (isDark) "#3F3F46" else "#E4E4E7"

        // Card container (bottom-aligned, rounded top corners)
        val cardBackground = GradientDrawable().apply {
            setColor(Color.parseColor(bgHex))
            cornerRadii = floatArrayOf(
                dp(24).toFloat(), dp(24).toFloat(), // top-left
                dp(24).toFloat(), dp(24).toFloat(), // top-right
                0f, 0f, 0f, 0f                      // bottom corners
            )
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBackground
            setPadding(dp(24), dp(20), dp(24), dp(40))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        // Drag handle
        val handleBg = GradientDrawable().apply {
            setColor(Color.parseColor(handleHex))
            cornerRadius = dp(2).toFloat()
        }
        val handle = View(this).apply {
            background = handleBg
        }
        card.addView(handle, LinearLayout.LayoutParams(dp(40), dp(4)).apply {
            bottomMargin = dp(20)
            gravity = Gravity.CENTER_HORIZONTAL
        })

        // Label
        val label = TextView(this).apply {
            text = "Ekwe Echo"
            setTextColor(Color.parseColor("#A1A1AA")) // zinc-400
            textSize = 10f
            letterSpacing = 0.15f
            isAllCaps = true
        }
        card.addView(label, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(16); gravity = Gravity.START })

        // Sophisticated Branded Native Pulse Animation
        val pulseContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(80)).apply {
                bottomMargin = dp(24)
                gravity = Gravity.CENTER_HORIZONTAL
            }
        }

        val innerDot = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#1A7EC8")) // Ekwe Accent Blue
            }
            layoutParams = FrameLayout.LayoutParams(dp(16), dp(16)).apply {
                gravity = Gravity.CENTER
            }
        }

        val pulseRing = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), Color.parseColor("#1A7EC8")) // Ekwe Accent Blue
            }
            layoutParams = FrameLayout.LayoutParams(dp(60), dp(60)).apply {
                gravity = Gravity.CENTER
            }
        }

        pulseContainer.addView(pulseRing)
        pulseContainer.addView(innerDot)
        card.addView(pulseContainer)

        // Android Native Object Animators
        val scaleX = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleX", 0.6f, 1.2f, 0.6f)
        val scaleY = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleY", 0.6f, 1.2f, 0.6f)
        val fade = android.animation.ObjectAnimator.ofFloat(pulseRing, "alpha", 1f, 0.2f, 1f)
        
        scaleX.repeatCount = android.animation.ObjectAnimator.INFINITE
        scaleY.repeatCount = android.animation.ObjectAnimator.INFINITE
        fade.repeatCount = android.animation.ObjectAnimator.INFINITE

        android.animation.AnimatorSet().apply {
            playTogether(scaleX, scaleY, fade)
            duration = 1800L
            start()
        }

        // Status text
        val status = TextView(this).apply {
            text = "Preparing voice note..."
            setTextColor(Color.parseColor("#FAFAFA")) // zinc-50 (Pure White-ish)
            textSize = 14f
            gravity = Gravity.CENTER
        }
        card.addView(status)

        // Position card at bottom of scrim
        val cardParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply { gravity = Gravity.BOTTOM }
        scrim.addView(card, cardParams)

        // Add to window on top of everything
        addContentView(scrim, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))

        nativeLoaderView = scrim
    }

    fun dismissNativeLoader() {
        nativeLoaderView?.let { view ->
            try {
                (view.parent as? ViewGroup)?.removeView(view)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to remove native loader", e)
            }
            nativeLoaderView = null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun getFileName(uri: Uri): String {
        var name = "shared_voice_${System.currentTimeMillis()}"
        try {
            val cursor: Cursor? = contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        name = it.getString(nameIndex) ?: name
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not get file name", e)
        }
        return name
    }

    private fun sendBubbleCommand(action: String) {
        try {
            val intent = Intent(this, BubbleService::class.java).apply {
                this.action = action
            }
            startService(intent)
        } catch (e: Exception) {
            // Service might not be running
        }
    }
}
