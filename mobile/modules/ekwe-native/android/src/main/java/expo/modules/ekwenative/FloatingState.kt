package expo.modules.ekwenative

import android.util.Log

enum class FloatingState {
    IDLE,
    BUBBLE_VISIBLE,
    BUBBLE_EXPANDED,
    OVERLAY_ACTIVE,
    HIDDEN_IDLE
}

data class QueuedIntent(
    val audioPath: String,
    val sourceApp: String
)

/**
 * Thread-safe state machine. All transitions go through here.
 * No window touches — pure state logic only.
 */
object FloatingStateEngine {
    private const val TAG = "FloatingStateEngine"

    @Volatile
    private var state: FloatingState = FloatingState.IDLE
    
    @Volatile
    var queuedIntent: QueuedIntent? = null
        private set

    @Synchronized
    fun getState(): FloatingState = state

    @Synchronized
    fun transition(to: FloatingState): Boolean {
        // Validate transitions
        val allowed = when (to) {
            FloatingState.BUBBLE_VISIBLE -> state == FloatingState.IDLE || state == FloatingState.HIDDEN_IDLE
            FloatingState.BUBBLE_EXPANDED -> state == FloatingState.BUBBLE_VISIBLE
            FloatingState.OVERLAY_ACTIVE -> state == FloatingState.IDLE
            FloatingState.HIDDEN_IDLE -> state == FloatingState.BUBBLE_VISIBLE || state == FloatingState.BUBBLE_EXPANDED
            FloatingState.IDLE -> true // always allowed, safe fallback
        }
        
        if (allowed) {
            Log.d(TAG, "Transitioning native UI state: $state -> $to")
            state = to
        } else {
            Log.w(TAG, "Rejected invalid native UI state transition: $state -> $to")
        }
        return allowed
    }

    @Synchronized
    fun enqueueIntent(audioPath: String, sourceApp: String) {
        Log.i(TAG, "Queueing Share Intent for audio path: $audioPath")
        queuedIntent = QueuedIntent(audioPath, sourceApp)
    }

    @Synchronized
    fun dequeueIntent(): QueuedIntent? {
        val intent = queuedIntent
        if (intent != null) {
            Log.i(TAG, "Dequeueing Share Intent for audio path: ${intent.audioPath}")
        }
        queuedIntent = null
        return intent
    }

    @Synchronized
    fun hasQueuedIntent(): Boolean = queuedIntent != null
}
