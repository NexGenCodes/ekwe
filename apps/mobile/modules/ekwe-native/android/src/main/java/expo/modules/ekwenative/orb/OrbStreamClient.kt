package expo.modules.ekwenative.orb

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class OrbStreamClient(
  private val wsUrl: String,
  private val token: String?,
  private val lang: String,
  private val onInterim: (text: String) -> Unit,
  private val onFinal: (text: String, language: String?) -> Unit,
  private val onLanguageDetected: (language: String) -> Unit,
  private val onStatus: (text: String) -> Unit,
  private val onState: (state: String, error: String?) -> Unit,
  private val onError: (msg: String) -> Unit,
  private val onClose: (code: Int, reason: String) -> Unit,
) {
  private val client = OkHttpClient.Builder()
    .readTimeout(60, TimeUnit.SECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .build()
  private var ws: WebSocket? = null
  private val ready = AtomicBoolean(false)
  private val closed = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())

  val isOpen: Boolean
    get() = ready.get() && !closed.get()

  fun connect() {
    onState("connecting", null)
    val builder = Request.Builder().url(wsUrl)
    if (!token.isNullOrBlank()) {
      builder.addHeader("Sec-WebSocket-Protocol", token)
    }
    ws = client.newWebSocket(builder.build(), object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        ready.set(true)
        sendConfig()
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        mainHandler.post { handleMessage(text) }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        ready.set(false)
        val alreadyClosed = closed.getAndSet(true)
        if (!alreadyClosed) {
          val msg = t.message?.takeIf { it.isNotBlank() } ?: "Connection failed"
          mainHandler.post {
            onState("error", msg)
            onError(msg)
            onClose(1011, msg)
          }
        }
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        ready.set(false)
        val alreadyClosed = closed.getAndSet(true)
        if (!alreadyClosed) {
          mainHandler.post {
            if (code != 1000) {
              val msg = reason.ifBlank { "Stream closed" }
              onState("error", msg)
            }
            onClose(code, reason)
          }
        }
      }
    })
  }

  private fun configJson(): JSONObject =
    JSONObject()
      .put("type", "config")
      .put("lang", lang)
      .put("format", "pcm_s16le")
      .put("sampleRate", 16000)
      .put("channels", 1)
      .put("frameSizeMs", 20)

  private fun sendConfig() {
    sendRaw(configJson().toString())
  }

  private fun handleMessage(text: String) {
    try {
      val j = JSONObject(text)
      when (j.optString("type", "")) {
        "ready" -> {
          onState("listening", null)
          onStatus("Listening…")
        }
        "config_ack" -> Unit
        "config_request" -> {
          sendConfig()
        }
        "interim" -> {
          onInterim(j.optString("text", ""))
        }
        "final" -> {
          val language = j.optString("language", "").takeIf { it.isNotBlank() }
          if (language != null) onLanguageDetected(language)
          onFinal(j.optString("text", ""), language)
        }
        "language_detected" -> {
          val language = j.optString("language", "").takeIf { it.isNotBlank() }
          if (language != null) onLanguageDetected(language)
        }
        "provider_switch" -> {
          onStatus("Reconnecting…")
        }
        "ping" -> {
          sendRaw(JSONObject().put("type", "pong").toString())
        }
        "stop" -> Unit
        "error" -> {
          val msg = j.optString("message", "").ifBlank {
            j.optString("error", "Stream error")
          }
          onState("error", msg)
          onError(msg)
        }
        else -> {
          // Defensive: some error payloads may omit/alter type.
          if (j.has("error") || j.has("message")) {
            val msg = j.optString("message", "").ifBlank {
              j.optString("error", "")
            }
            if (msg.isNotBlank()) onError(msg)
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed to parse stream message", e)
    }
  }

  fun sendPcm(samples: ShortArray, count: Int) {
    if (!isOpen || count <= 0) return
    val socket = ws ?: return
    val bytes = ByteArray(count * 2)
    var j = 0
    for (i in 0 until count) {
      val v = samples[i].toInt()
      bytes[j++] = (v and 0xFF).toByte()
      bytes[j++] = ((v shr 8) and 0xFF).toByte()
    }
    runCatching { socket.send(ByteString.of(*bytes)) }
  }

  fun sendVad(active: Boolean) {
    sendRaw(JSONObject().put("type", "vad").put("active", active).toString())
  }

  fun requestStop() {
    sendRaw(JSONObject().put("type", "stop").toString())
  }

  fun close(code: Int = 1000, reason: String = "done") {
    val alreadyClosed = closed.getAndSet(true)
    ready.set(false)
    if (!alreadyClosed) {
      runCatching { requestStop() }
    }
    runCatching { ws?.close(code, reason) }
    ws = null
  }

  private fun sendRaw(text: String) {
    val socket = ws ?: return
    runCatching { socket.send(text) }
  }

  companion object {
    private const val TAG = "EkweOrbStream"
  }
}
