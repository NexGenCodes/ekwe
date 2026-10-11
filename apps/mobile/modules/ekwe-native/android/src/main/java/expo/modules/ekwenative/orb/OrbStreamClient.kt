package expo.modules.ekwenative.orb

import android.os.Handler
import android.os.Looper
import okhttp3.*
import okio.ByteString
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class OrbStreamClient(
  private val wsUrl: String,
  private val onInterim: (text: String) -> Unit,
  private val onFinal: (text: String, language: String?) -> Unit,
  private val onError: (msg: String) -> Unit,
  private val onClose: () -> Unit
) {
  private val client = OkHttpClient.Builder()
    .readTimeout(30, TimeUnit.SECONDS)
    .pingInterval(15, TimeUnit.SECONDS)
    .build()
  private var ws: WebSocket? = null
  private var open = false
  private val handler = Handler(Looper.getMainLooper())

  fun open(configJson: JSONObject) {
    val req = Request.Builder().url(wsUrl).build()
    ws = client.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        open = true
        webSocket.send(configJson.toString())
      }
      override fun onMessage(webSocket: WebSocket, text: String) {
        try {
          val j = JSONObject(text)
          when (j.optString("type")) {
            "interim" -> onInterim(j.optString("text", ""))
            "final" -> onFinal(j.optString("text", ""), j.optString("language", null))
            "error" -> onError(j.optString("message", "stream error"))
          }
        } catch (_: Exception) {}
      }
      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        open = false
        handler.post { onError(t.message ?: "ws failure") }
      }
      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        open = false
        handler.post { onClose() }
      }
    })
  }

  fun sendBinary(bytes: ByteArray) {
    if (!open) return
    ws?.send(ByteString.of(*bytes))
  }

  fun close(code: Int = 1000, reason: String = "done") {
    open = false
    ws?.close(code, reason)
    ws = null
  }
}
