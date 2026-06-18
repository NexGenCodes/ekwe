package expo.modules.ekwenative

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.core.app.NotificationCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.io.File
import java.io.FileOutputStream

class BubbleService : Service() {
    private val TAG = "BubbleService"
    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var cardView: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var cardParams: WindowManager.LayoutParams? = null
    
    private val IDLE_TIMEOUT_MS = 30 * 60 * 1000L
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val idleRunnable = Runnable {
        transitionTo(FloatingState.IDLE, "idle_timeout")
        stopSelf()
    }

    private fun resetIdleTimeout() {
        handler.removeCallbacks(idleRunnable)
        handler.postDelayed(idleRunnable, IDLE_TIMEOUT_MS)
    }

    private val lifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            super.onStart(owner)
            EkweNativeModule.emitAppForeground()
            if (FloatingStateEngine.getState() in listOf(FloatingState.BUBBLE_VISIBLE, FloatingState.BUBBLE_EXPANDED)) {
                transitionTo(FloatingState.HIDDEN_IDLE, "app_foreground")
            }
        }

        override fun onStop(owner: LifecycleOwner) {
            super.onStop(owner)
            EkweNativeModule.emitAppBackground()
            if (FloatingStateEngine.getState() == FloatingState.HIDDEN_IDLE) {
                transitionTo(FloatingState.BUBBLE_VISIBLE, "app_background")
            }
        }
    }

    companion object {
        const val ACTION_START = "com.ekwe.BUBBLE_START"
        const val ACTION_STOP = "com.ekwe.BUBBLE_STOP"
        const val ACTION_EXPAND_BUBBLE = "com.ekwe.BUBBLE_EXPAND"
        const val ACTION_COLLAPSE_BUBBLE = "com.ekwe.BUBBLE_COLLAPSE"
        const val ACTION_UPDATE_STATE = "com.ekwe.BUBBLE_STATE"
        const val ACTION_HIDE_LENS = "com.ekwe.LENS_HIDE"
        const val ACTION_SHOW_LENS = "com.ekwe.LENS_SHOW"

        // Deprecated constants kept for backward compatibility with EkweNativeModule
        const val ACTION_SHOW_OVERLAY = "com.ekwe.OVERLAY_SHOW"
        const val ACTION_DISMISS_OVERLAY = "com.ekwe.OVERLAY_DISMISS"

        const val EXTRA_AUDIO_PATH = "audioPath"
        const val EXTRA_SOURCE_APP = "sourceApp"
        const val EXTRA_MODE = "mode"
        const val EXTRA_DATA = "data"

        const val CHANNEL_ID = "ekwe_bubble"
        const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        handler.post {
            ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_STICKY
        
        when (action) {
            ACTION_START -> {
                startBubbleForeground()
                transitionTo(FloatingState.BUBBLE_VISIBLE, "user_start")
                resetIdleTimeout()
            }
            ACTION_STOP -> {
                transitionTo(FloatingState.IDLE, "user_stop")
                stopSelf()
            }
            ACTION_HIDE_LENS -> {
                transitionTo(FloatingState.HIDDEN_IDLE, "echo_session_start")
            }
            ACTION_SHOW_LENS -> {
                if (FloatingStateEngine.getState() == FloatingState.HIDDEN_IDLE) {
                    transitionTo(FloatingState.BUBBLE_VISIBLE, "echo_session_end")
                }
            }
            ACTION_UPDATE_STATE -> {
                updateBubbleStyle(intent.getStringExtra(EXTRA_MODE) ?: "IDLE", intent.getStringExtra(EXTRA_DATA))
            }
            // NO-OP for deprecated overlay actions
            ACTION_SHOW_OVERLAY, ACTION_DISMISS_OVERLAY -> {
                // Do nothing, handled by ShareActivity (Ekwe Echo)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(idleRunnable)
        handler.post {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
        transitionTo(FloatingState.IDLE, "service_destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun transitionTo(newState: FloatingState, reason: String) {
        val oldState = FloatingStateEngine.getState()
        if (FloatingStateEngine.transition(newState)) {
            EkweNativeModule.emitStateChanged(newState.name, oldState.name, reason)
            syncUI()
        }
    }

    private fun syncUI() {
        handler.post {
            when (FloatingStateEngine.getState()) {
                FloatingState.IDLE, FloatingState.HIDDEN_IDLE -> {
                    removeFloatingBubble()
                    removeFloatingCard()
                }
                FloatingState.BUBBLE_VISIBLE, FloatingState.BUBBLE_EXPANDED -> {
                    showFloatingBubble()
                }
                FloatingState.OVERLAY_ACTIVE -> {
                    removeFloatingBubble()
                    removeFloatingCard()
                }
            }
        }
    }

    @SuppressLint("InflateParams", "ClickableViewAccessibility")
    private fun showFloatingBubble() {
        if (floatingView != null) return
        val bubble = FrameLayout(this).apply {
            val inner = View(context).apply {
                id = 1337
                setBackgroundColor(Color.parseColor("#3B82F6"))
                layoutParams = FrameLayout.LayoutParams(140, 140)
            }
            addView(inner)
        }
        floatingView = bubble
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 100; y = 100
        }
        windowManager?.addView(floatingView, params)
        setupDrag(floatingView!!, params!!)
    }

    private fun setupDrag(view: View, p: WindowManager.LayoutParams) {
        view.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0; private var initialY = 0
            private var initialTouchX = 0f; private var initialTouchY = 0f
            override fun onTouch(v: View?, event: MotionEvent?): Boolean {
                when (event?.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = p.x; initialY = p.y
                        initialTouchX = event.rawX; initialTouchY = event.rawY
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        p.x = initialX + (event.rawX - initialTouchX).toInt()
                        p.y = initialY + (event.rawY - initialTouchY).toInt()
                        windowManager?.updateViewLayout(view, p)
                        return true
                    }
                }
                return false
            }
        })
    }

    private fun removeFloatingBubble() {
        floatingView?.let { try { windowManager?.removeView(it) } catch (e: Exception) { Log.e(TAG, "Failed to remove bubble", e) } }
        floatingView = null
    }

    private fun removeFloatingCard() {
        cardView?.let { try { windowManager?.removeView(it) } catch (e: Exception) { Log.e(TAG, "Failed to remove card", e) } }
        cardView = null
    }

    private fun updateBubbleStyle(mode: String, data: String?) {
        val inner = floatingView?.findViewById<View>(1337) ?: return
        inner.setBackgroundColor(when(mode) {
            "MAGIC" -> Color.parseColor("#22C55E")
            "RECORD" -> Color.parseColor("#EF4444")
            else -> Color.parseColor("#3B82F6")
        })
    }

    private fun startBubbleForeground() {
        createNotificationChannel()
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Ekwe Lens Active")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Ekwe Lens"
            val descriptionText = "Ensures Ekwe Echo can process audio in the background"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                setSound(null, null)
                enableVibration(false)
            }
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
}
