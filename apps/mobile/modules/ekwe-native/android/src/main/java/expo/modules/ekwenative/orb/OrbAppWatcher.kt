package expo.modules.ekwenative.orb

import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.ekwenative.R
import java.util.SortedMap
import java.util.TreeMap

class OrbAppWatcher(
  private val context: Context,
  private val onForegroundChanged: (packageName: String, label: String) -> Unit
) {
  private val handler = Handler(Looper.getMainLooper())
  private var running = false
  private var lastPkg: String? = null

  private val poll = object : Runnable {
    override fun run() {
      if (!running) return
      val pkg = getForegroundPackageName()
      if (pkg != null && pkg != lastPkg) {
        lastPkg = pkg
        val label = getLabel(pkg)
        onForegroundChanged(pkg, label)
      }
      handler.postDelayed(this, 1000)
    }
  }

  fun start() {
    if (running) return
    running = true
    handler.post(poll)
  }

  fun stop() {
    running = false
    handler.removeCallbacks(poll)
    lastPkg = null
  }

  private fun getForegroundPackageName(): String? {
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
    val end = System.currentTimeMillis()
    val start = end - 10000
    val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, start, end)
    if (stats.isNullOrEmpty()) return null
    var lastTime: Long = 0
    var pkg: String? = null
    val sorted: SortedMap<Long, String> = TreeMap()
    for (s in stats) {
      if (s.lastTimeUsed > lastTime) {
        lastTime = s.lastTimeUsed
        pkg = s.packageName
      }
    }
    return pkg
  }

  private fun getLabel(pkg: String): String {
    return try {
      val pm = context.packageManager
      val info = pm.getApplicationInfo(pkg, 0)
      pm.getApplicationLabel(info).toString()
    } catch (_: Exception) {
      pkg
    }
  }
}
