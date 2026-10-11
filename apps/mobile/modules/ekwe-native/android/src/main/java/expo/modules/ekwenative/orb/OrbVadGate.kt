package expo.modules.ekwenative.orb

class OrbVadGate(
  private val trailingMs: Long = 800L
) {
  private var lastNonSilenceMs: Long = 0L
  private var hasNonSilence = false

  fun onAmplitudeDb(db: Float) {
    val t = System.currentTimeMillis()
    if (db > -60f) {
      lastNonSilenceMs = t
      hasNonSilence = true
    }
  }

  fun isSilencedForTooLong(): Boolean {
    if (!hasNonSilence) return false
    val elapsed = System.currentTimeMillis() - lastNonSilenceMs
    return elapsed >= trailingMs
  }

  fun reset() {
    lastNonSilenceMs = 0L
    hasNonSilence = false
  }
}
