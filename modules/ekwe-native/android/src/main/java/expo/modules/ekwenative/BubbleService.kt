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
    private var cardView: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var cardParams: WindowManager.LayoutParams? = null
    
    // PRO-GRADE: Battery Optimization
    private val IDLE_TIMEOUT_MS = 30 * 60 * 1000L // 30 minutes
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val idleRunnable = Runnable {
        Log.d("EkweBubble", "Idle timeout reached — closing service and removing windows")
        EkweNativeModule.emitBubbleEvent("STOPPED", mapOf("reason" to "idle_timeout"))
        removeFloatingBubble()
        removeFloatingCard()
        stopSelf()
    }

    private fun resetIdleTimeout() {
        handler.removeCallbacks(idleRunnable)
        handler.postDelayed(idleRunnable, IDLE_TIMEOUT_MS)
    }

    companion object {
        const val ACTION_START = "com.ekwe.BUBBLE_START"
        const val ACTION_STOP = "com.ekwe.BUBBLE_STOP"
        const val ACTION_UPDATE_VISIBILITY = "com.ekwe.BUBBLE_VISIBILITY"
        const val ACTION_UPDATE_STATE = "com.ekwe.BUBBLE_STATE"
        const val ACTION_SHOW_CARD = "com.ekwe.CARD_SHOW"
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
                EkweNativeModule.emitBubbleEvent("STARTED")
                resetIdleTimeout()
            }
            ACTION_STOP -> {
                EkweNativeModule.emitBubbleEvent("STOPPED", mapOf("reason" to "user_stop"))
                removeFloatingBubble()
                removeFloatingCard()
                stopSelf()
            }
            ACTION_UPDATE_VISIBILITY -> {
                val visible = intent.getBooleanExtra("visible", true)
                updateVisibility(visible)
            }
            ACTION_UPDATE_STATE -> {
                val mode = intent.getStringExtra("mode") ?: "IDLE"
                val data = intent.getStringExtra("data")
                updateState(mode, data)
            }
            ACTION_SHOW_CARD -> {
                val transcription = intent.getStringExtra("transcription") ?: ""
                val translation = intent.getStringExtra("translation") ?: ""
                startBubbleForeground() // Ensure service is running
                showFloatingCard(transcription, translation)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(idleRunnable)
        EkweNativeModule.emitBubbleEvent("STOPPED", mapOf("reason" to "service_destroyed"))
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
                id = 1337
                setBackgroundColor(Color.parseColor("#1A7EC8"))
                val lp = FrameLayout.LayoutParams(140, 140)
                layoutParams = lp
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
            try {
                windowManager?.removeView(floatingView)
            } catch (e: Exception) { }
            floatingView = null
        }
    }

    private fun removeFloatingCard() {
        if (cardView != null) {
            try {
                windowManager?.removeView(cardView)
            } catch (e: Exception) { }
            cardView = null
        }
    }

    @SuppressLint("InflateParams", "ClickableViewAccessibility")
    private fun showFloatingCard(transcription: String, translation: String) {
        removeFloatingBubble() // EXCLUSIVITY: Remove bubble when card is shown
        if (cardView != null) removeFloatingCard()

        // Build a programmatic premium card
        val ctx = this
        val container = FrameLayout(ctx).apply {
            val padding = 16
            setPadding(padding, padding, padding, padding)
        }

        val card = androidx.cardview.widget.CardView(ctx).apply {
            id = 2001
            radius = 64f
            cardElevation = 24f
            setCardBackgroundColor(Color.parseColor("#09090B")) // Midnight Noir
            
            val layout = android.widget.LinearLayout(ctx).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding(40, 40, 40, 40)
                
                // Header
                addView(android.widget.TextView(ctx).apply {
                    text = "Ekwe Insights"
                    setTextColor(Color.parseColor("#94A3B8")) // Slate 400
                    textSize = 12f
                    setPadding(0, 0, 0, 16)
                })

                // Translation (Primary)
                addView(android.widget.TextView(ctx).apply {
                    text = translation
                    setTextColor(Color.YELLOW) // High contrast
                    textSize = 18f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                })

                // Transcription (Secondary - Scrollable)
                val scrollView = android.widget.ScrollView(ctx).apply {
                    val lp = android.widget.LinearLayout.LayoutParams(
                        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                        300 // Max height
                    )
                    lp.setMargins(0, 20, 0, 20)
                    layoutParams = lp
                    
                    addView(android.widget.TextView(ctx).apply {
                        text = transcription
                        setTextColor(Color.WHITE)
                        textSize = 14f
                    })
                }
                addView(scrollView)

                // Actions
                val actions = android.widget.LinearLayout(ctx).apply {
                    orientation = android.widget.LinearLayout.HORIZONTAL
                    gravity = Gravity.END
                    
                    addView(android.widget.Button(ctx).apply {
                        text = "Copy"
                        setBackgroundColor(Color.TRANSPARENT)
                        setTextColor(Color.parseColor("#3B82F6")) // Blue 500
                        setOnClickListener {
                            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                            val clip = android.content.ClipData.newPlainText("ekwe", translation)
                            clipboard.setPrimaryClip(clip)
                            android.widget.Toast.makeText(ctx, "Copied to clipboard", android.widget.Toast.LENGTH_SHORT).show()
                        }
                    })

                    addView(android.widget.Button(ctx).apply {
                        text = "Dismiss"
                        setBackgroundColor(Color.TRANSPARENT)
                        setTextColor(Color.parseColor("#EF4444")) // Red 500
                        setOnClickListener {
                            removeFloatingCard()
                            showFloatingBubble() // Return to bubble mode
                        }
                    })
                }
                addView(actions)
            }
            addView(layout)
        }
        
        container.addView(card)
        cardView = container

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        cardParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
            x = 0
            y = 0
        }

        windowManager?.addView(cardView, cardParams)
    }

    private fun updateVisibility(visible: Boolean) {
        floatingView?.visibility = if (visible) View.VISIBLE else View.GONE
    }

    private fun updateState(mode: String, data: String?) {
        val bubbleInner = floatingView?.findViewById<View>(1337) ?: return
        when (mode) {
            "MAGIC" -> bubbleInner.setBackgroundColor(Color.parseColor("#22C55E")) // Green for success/magic
            "RECORD" -> bubbleInner.setBackgroundColor(Color.parseColor("#EF4444")) // Red for recording alert
            else -> bubbleInner.setBackgroundColor(Color.parseColor("#1A7EC8")) // Original Blue
        }
    }

    private fun startBubbleForeground(title: String = "Ekwe Floating Mode", text: String = "Listening in background") {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
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

