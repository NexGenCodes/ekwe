package expo.modules.ekwenative

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.util.Log

class EkweAccessibilityService : AccessibilityService() {

    companion object {
        var isRunning = false
        private set

        private var instance: EkweAccessibilityService? = null

        fun getInstance(): EkweAccessibilityService? = instance
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isRunning = true
        instance = this
        Log.d("EkweAccessibility", "Service Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val packageName = event.packageName?.toString()
            if (packageName != null) {
                // Emit event to JS via static hook or broadcast
                // For Expo Modules, we usually use a shared instance logic
                EkweNativeModule.instance?.sendForegroundAppEvent(packageName)
            }
        }
    }

    override fun onInterrupt() {
        // Not used
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        isRunning = false
        instance = null
        return super.onUnbind(intent)
    }
}
