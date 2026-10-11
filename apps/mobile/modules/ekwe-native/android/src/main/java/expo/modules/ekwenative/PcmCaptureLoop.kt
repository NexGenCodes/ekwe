package expo.modules.ekwenative

import android.media.AudioRecord
import android.util.Log
import kotlin.concurrent.thread

class PcmCaptureLoop(private val tag: String) {
  @Volatile
  var running = false
    private set

  @Volatile
  var amplitude = 0f
    private set

  @Volatile
  var peakAmplitude = 0f
    private set

  private var worker: Thread? = null
  private var record: AudioRecord? = null

  private val downsampleOut = ShortArray(160)
  private var downsampleOutCount = 0

  // The native decode contract is mono PCM at 16 kHz (kRecorderSampleRate in
  // EkweAudioDecoder.h). MediaProjection hands back 48 kHz, which is decimated
  // 3:1 below, so the controller is opened at the rate of the samples it is
  // fed — not at the rate the recorder was configured with.
  private companion object {
    const val TARGET_SAMPLE_RATE = 16000
    const val DECIMATED_SOURCE_RATE = 48000
  }

  private fun downsample48to16(buffer: ShortArray, inCount: Int, feed: (ShortArray, Int) -> Unit) {
    var i = 0
    while (i < inCount) {
      val s1 = buffer[i++]
      if (i >= inCount) break
      val s2 = buffer[i++]
      if (i >= inCount) break
      val s3 = buffer[i++]
      val t = (s1 + s2 + s3) / 3
      val outArr = downsampleOut
      outArr[downsampleOutCount++] = t.toShort()
      if (downsampleOutCount == downsampleOut.size) {
        feed(outArr.copyOf(), outArr.size)
        downsampleOutCount = 0
      }
    }
  }

  fun start(audioRecord: AudioRecord, outputPath: String, isLive: Boolean): Boolean {
    if (running) return false

    val recorderRate = audioRecord.sampleRate
    val decimate = recorderRate == DECIMATED_SOURCE_RATE
    val feedRate = if (decimate) TARGET_SAMPLE_RATE else recorderRate

    if (feedRate != TARGET_SAMPLE_RATE) {
      Log.e(tag, "unsupported capture rate $recorderRate Hz; want $TARGET_SAMPLE_RATE or $DECIMATED_SOURCE_RATE")
      return false
    }

    if (!EkweNativeModule.nativeInitCapture(
        outputPath,
        feedRate,
        audioRecord.channelCount,
        isLive
      )
    ) {
      Log.e(tag, "nativeInitCapture failed (sr=$feedRate ch=${audioRecord.channelCount})")
      return false
    }

    try {
      audioRecord.startRecording()
    } catch (e: IllegalStateException) {
      Log.e(tag, "startRecording rejected: ${e.message}")
      return false
    }

    record = audioRecord
    running = true
    val buffer = ShortArray(audioRecord.bufferSizeInFrames.coerceAtLeast(1024))
    worker = thread(name = tag) {
      try {
        while (running) {
          val read = audioRecord.read(buffer, 0, buffer.size)
          if (read > 0) {
            if (decimate) {
              downsample48to16(buffer, read) { data, count ->
                EkweNativeModule.nativeFeedPcm(data, count)
              }
              if (downsampleOutCount > 0) {
                val tail = downsampleOut.copyOf(downsampleOutCount)
                EkweNativeModule.nativeFeedPcm(tail, tail.size)
                downsampleOutCount = 0
              }
            } else {
              EkweNativeModule.nativeFeedPcm(buffer, read)
            }
            val rms = EkweNativeModule.nativeGetAmplitude()
            amplitude = rms
            if (rms > peakAmplitude) peakAmplitude = rms
          } else if (read < 0) {
            Log.w(tag, "read returned $read")
            break
          }
        }
      } catch (e: IllegalStateException) {
        Log.e(tag, "loop ended: ${e.message}")
      }
      running = false
    }
    return true
  }

  fun stop() {
    running = false
    runCatching { record?.stop() }
    val current = worker
    if (current != null && current !== Thread.currentThread()) {
      current.interrupt()
      runCatching { current.join(500) }
    }
    worker = null
    runCatching { record?.release() }
    record = null
    EkweNativeModule.nativeStopCapture()
  }
}