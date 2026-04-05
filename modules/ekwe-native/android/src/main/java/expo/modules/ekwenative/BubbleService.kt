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
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.app.NotificationCompat

class BubbleService : Service() {

    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var params: WindowManager.LayoutParams? = null

    companion object {
        const val ACTION_START = "com.ekwe.BUBBLE_START"
        const val ACTION_STOP = "com.ekwe.BUBBLE_STOP"
        const val CHANNEL_ID = "ekwe_bubble"
        const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startBubbleForeground()
                showFloatingBubble()
            }
            ACTION_STOP -> {
                removeFloatingBubble()
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        removeFloatingBubble()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("InflateParams", "ClickableViewAccessibility")
    private fun showFloatingBubble() {
        if (floatingView != null) return

        // Create a simple circular bubble view programmatically or via layout
        // For now, let's use a programmatic approach for simplicity
        val bubble = FrameLayout(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            val inner = View(context).apply {
                setBackgroundColor(Color.parseColor("#1A7EC8"))
                val lp = FrameLayout.LayoutParams(140, 140)
                layoutParams = lp
                // Use a simple circle shape if possible, or just a colored box for now
                // Ideally, a drawable resource would be better.
            }
            addView(inner)
        }

        floatingView = bubble

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 100
            y = 100
        }

        windowManager?.addView(floatingView, params)

        // Drag handling
        floatingView?.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f

            override fun onTouch(v: View?, event: MotionEvent?): Boolean {
                when (event?.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params!!.x
                        initialY = params!!.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        val diffX = (event.rawX - initialTouchX).toInt()
                        val diffY = (event.rawY - initialTouchY).toInt()
                        if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) {
                            // Tap event - Open App
                            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                            launchIntent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            startActivity(launchIntent)
                        }
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params!!.x = initialX + (event.rawX - initialTouchX).toInt()
                        params!!.y = initialY + (event.rawY - initialTouchY).toInt()
                        windowManager?.updateViewLayout(floatingView, params)
                        return true
                    }
                }
                return false
            }
        })
    }

    private fun removeFloatingBubble() {
        if (floatingView != null) {
            windowManager?.removeView(floatingView)
            floatingView = null
        }
    }

    private fun startBubbleForeground() {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Ekwe Floating Mode")
            .setContentText("Listening in background")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Ekwe Bubble",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Active while Ekwe is in floating mode"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(channel)
    }
}

