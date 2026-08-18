package expo.modules.ekwenative

import android.content.Intent
import android.content.res.Configuration
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
 * ShareActivity — translucent Echo overlay.
 *
 * 1. Shows a native loading card INSTANTLY in onCreate().
 * 2. Passes the raw content:// URI directly to React Native as a prop.
 * 3. React Native renders the `share-extension` root (the Echo sheet) over the
 *    source app — the main app is never opened and the user stays where they were.
 *
 * The shared audio is resolved asynchronously in the JS thread via
 * EkweNative.resolveContentUri(), which copies the content grant into private
 * cache before it can expire. No React Native engine boots before the UI is
 * already interactive (the translucent theme shows the source app behind us).
 */
class ShareActivity : ReactActivity() {

    companion object {
        private const val TAG = "ShareActivity"

        // A shared_voice_* file younger than this is presumed to be actively
        // in use by an in-flight transcode (resolveAndTranscodeToOpus reads it
        // in another Activity), so the wipe must NOT delete it. Only files
        // untouched for this long are safe to treat as orphans.
        private const val WIPE_MIN_AGE_MS = 10 * 60 * 1000L

        @Volatile
        var nativeLoaderView: View? = null

        // Suffix segments typically appended to source-app packages inside
        // content provider authorities, e.g. "com.whatsapp.provider.media".
        private val PROVIDER_AUTHORITY_NOISE = setOf(
            "provider", "fileprovider", "media", "files", "cache", "content", "share", "cp"
        )
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
            val streamUri = if (intent.action == Intent.ACTION_SEND) {
                intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            } else if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.firstOrNull()
            } else null

            bundle.putString("sourceApp", extractSourceApp(intent, streamUri))

            if (streamUri != null) {
                bundle.putString("audioUri", streamUri.toString())
                val mimeType = contentResolver.getType(streamUri) ?: "audio/mpeg"
                bundle.putString("mimeType", mimeType)
            }
        }
    }

    /**
     * Best-effort detection of the app that shared the audio:
     * 1. Referrer (android-app://com.whatsapp/...)
     * 2. EXTRA_REFERRER_NAME
     * 3. The content provider authority, which usually embeds the source
     *    package, e.g. "com.whatsapp.provider.media" → "com.whatsapp".
     *
     * Prefers the installed app's real display label (via PackageManager),
     * which is complete and never truncates — the raw package is only
     * returned when no label can be resolved.
     */
    private fun extractSourceApp(intent: Intent, streamUri: Uri?): String {
        val packageCandidates = arrayListOf<String>()
        // getReferrer() can throw SecurityException on some devices/OEMs.
        runCatching { referrer }
            .getOrNull()
            ?.host
            ?.takeIf { it.isNotBlank() }
            ?.let { packageCandidates.add(stripUidPrefix(it)) }

        intent.getStringExtra(Intent.EXTRA_REFERRER_NAME)?.let { name ->
            if (name.isNotBlank()) {
                runCatching { Uri.parse(name).host }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?.let { packageCandidates.add(stripUidPrefix(it)) }
            }
        }

        streamUri?.authority?.let { authority ->
            val cleaned = authority
                .split(".")
                .filterNot { it in PROVIDER_AUTHORITY_NOISE }
                .joinToString(".")
            if (cleaned.isNotBlank()) packageCandidates.add(stripUidPrefix(cleaned))
        }

        packageCandidates.forEach { candidate ->
            resolveAppLabel(candidate)?.let { return it }
        }

        return packageCandidates.firstOrNull() ?: ""
    }

    /**
     * Cross-user content URIs prefix the authority with a UID, e.g.
     * "999@com.whatsapp.w4b". Strip everything up to and including "@"
     * so we get a usable package name.
     */
    private fun stripUidPrefix(raw: String): String =
        if ('@' in raw) raw.substringAfter('@') else raw

    /** Returns the installed app's display name for [packageName], or null. */
    private fun resolveAppLabel(packageName: String): String? {
        return try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(info)?.toString()?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
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
        // This is a singleTask activity, so a second share after a device theme
        // change reuses this instance and SKIPS onCreate(). Re-show a freshly
        // themed native card (idempotent) so the overlay follows the current
        // appearance instead of the color it was created with.
        showNativeLoadingCard()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Device theme toggled while the card is visible (needs uiMode in
        // android:configChanges for this to fire instead of a recreate).
        if (nativeLoaderView != null) {
            showNativeLoadingCard()
        }
    }

    override fun onDestroy() {
        wipeOrphanedCacheFiles()
        dismissNativeLoader()
        super.onDestroy()
    }

    // ── Native Loader UI ──────────────────────────────────────────────────

    private fun showNativeLoadingCard() {
        // Idempotent: a singleTask reuse or uiMode config change may re-invoke
        // this, so tear down any previously shown card before adding a fresh one.
        dismissNativeLoader()

        val dp = { value: Int ->
            TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
        }

        val isDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val scrimColor = EchoDesignTokens.Semantic.overlay.color(isDark)
        val cardColor = EchoDesignTokens.Semantic.card.color(isDark)
        val handleColor = EchoDesignTokens.Semantic.handle.color(isDark)
        val labelColor = EchoDesignTokens.Semantic.muted.color(isDark)
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
            setPadding(dp(24), dp(20), dp(24), dp(40))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        // Drag handle
        card.addView(View(this).apply {
            background = GradientDrawable().apply { setColor(handleColor); cornerRadius = dp(2).toFloat() }
        }, LinearLayout.LayoutParams(dp(40), dp(4)).apply { bottomMargin = dp(20); gravity = Gravity.CENTER_HORIZONTAL })

        // Label
        card.addView(TextView(this).apply {
            text = "Ekwe Echo"
            setTextColor(labelColor)
            textSize = 10f
            letterSpacing = 0.15f
            isAllCaps = true
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16); gravity = Gravity.START })

        // Pulse Animation
        val pulseContainer = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(80), dp(80)).apply { bottomMargin = dp(24); gravity = Gravity.CENTER_HORIZONTAL }
        }
        val pulseRing = View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setStroke(dp(2), pulseColor) }
            layoutParams = FrameLayout.LayoutParams(dp(60), dp(60)).apply { gravity = Gravity.CENTER }
        }
        pulseContainer.addView(pulseRing)
        pulseContainer.addView(View(this).apply {
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(pulseColor) }
            layoutParams = FrameLayout.LayoutParams(dp(16), dp(16)).apply { gravity = Gravity.CENTER }
        })
        card.addView(pulseContainer)

        val scaleX = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleX", 0.6f, 1.2f, 0.6f).apply { repeatCount = -1 }
        val scaleY = android.animation.ObjectAnimator.ofFloat(pulseRing, "scaleY", 0.6f, 1.2f, 0.6f).apply { repeatCount = -1 }
        val fade = android.animation.ObjectAnimator.ofFloat(pulseRing, "alpha", 1f, 0.2f, 1f).apply { repeatCount = -1 }
        android.animation.AnimatorSet().apply { playTogether(scaleX, scaleY, fade); duration = 1800L; start() }

        card.addView(TextView(this).apply {
            text = "Preparing voice note..."
            setTextColor(textColor)
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
                val staleBefore = System.currentTimeMillis() - WIPE_MIN_AGE_MS
                cacheDir.listFiles()?.forEach { file ->
                    // Age-gate: deleting every shared_voice_* file here could
                    // wipe a file another Activity is still transcoding (the
                    // transcode reads it on its own thread), corrupting the
                    // output. Only remove files that are old enough to be
                    // genuine orphans.
                    if (file.name.startsWith("shared_voice_") && file.lastModified() < staleBefore) {
                        file.delete()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed cache wipe", e)
            }
        }.start()
    }
}
