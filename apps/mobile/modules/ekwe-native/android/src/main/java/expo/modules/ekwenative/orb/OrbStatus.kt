package expo.modules.ekwenative.orb

data class OrbStatus(
  val running: Boolean,
  val hasMediaProjection: Boolean,
  val foregroundApp: String?,
  val lastPeakAmplitude: Float
)
