package expo.modules.ekwenative

import android.media.AudioRecord
import android.util.Log
import kotlin.concurrent.thread
import kotlin.math.sqrt

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
  private var nativeInited = false

  // 48kHz -> 16kHz decimation (3:1). We must preserve leftover samples across
  // read boundaries to avoid systematic sample loss/phase drift.
  private val downsampleOut = ShortArray(160)
  private var downsampleOutCount = 0
  private val carry = ShortArray(2)
  private var carryCount = 0

  private companion object {
    const val TARGET_SAMPLE_RATE = 16000
    const val DECIMATED_SOURCE_RATE = 48000
  }

  private fun resetDownsampler() {
    downsampleOutCount = 0
    carryCount = 0
  }

  private fun downsample48to16(
    buffer: ShortArray,
    inCount: Int,
    feed: (ShortArray, Int) -> Unit,
  ) {
    var i = 0
    val needed = (3 - carryCount) % 3
    if (carryCount > 0) {
      while (i < inCount && carryCount < 3) {
        carry[carryCount++] = buffer[i++]
      }
      if (carryCount == 3) {
        emitTriplet(carry[0], carry[1], carry[2], feed)
        carryCount = 0
      } else {
        return
      }
    }

    while (i + 2 < inCount) {
      emitTriplet(buffer[i], buffer[i + 1], buffer[i + 2], feed)
      i += 3
    }

    while (i < inCount) {
      carry[carryCount++] = buffer[i++]
    }
  }

  private fun emitTriplet(
    s1: Short,
    s2: Short,
    s3: Short,
    feed: (ShortArray, Int) -> Unit,
  ) {
    val mixed = ((s1.toInt() + s2.toInt() + s3.toInt()) / 3).toShort()
    downsampleOut[downsampleOutCount++] = mixed
    if (downsampleOutCount == downsampleOut.size) {
      feed(downsampleOut.copyOf(), downsampleOut.size)
      downsampleOutCount = 0
    }
  }

  private fun flushDownsampleTail(feed: (ShortArray, Int) -> Unit) {
    if (downsampleOutCount > 0) {
      feed(downsampleOut.copyOf(downsampleOutCount), downsampleOutCount)
      downsampleOutCount = 0
    }
    // Drop incomplete carry (<3 samples) at end-of-stream; at 48kHz that's < 0.0625ms.
    carryCount = 0
  }

  private fun updateAmplitude(data: ShortArray, count: Int) {
    if (count <= 0) return
    var sum = 0.0
    for (i in 0 until count) {
      val s = data[i] / 32768.0
      sum += s * s
    }
    val rms = sqrt(sum / count).toFloat()
    amplitude = rms
    if (rms > peakAmplitude) peakAmplitude = rms
  }

  fun start(
    audioRecord: AudioRecord,
    outputPath: String,
    isLive: Boolean,
    writeFile: Boolean = true,
    onPcm16k: ((ShortArray, Int) -> Unit)? = null,
  ): Boolean {
    if (running) return false

    val recorderRate = audioRecord.sampleRate
    val decimate = recorderRate == DECIMATED_SOURCE_RATE
    val feedRate = if (decimate) TARGET_SAMPLE_RATE else recorderRate

    if (feedRate != TARGET_SAMPLE_RATE) {
      Log.e(
        tag,
        "unsupported capture rate $recorderRate Hz; want $TARGET_SAMPLE_RATE or $DECIMATED_SOURCE_RATE",
      )
      return false
    }

    nativeInited = false
    resetDownsampler()
    amplitude = 0f
    peakAmplitude = 0f

    if (writeFile) {
      if (!EkweNativeModule.nativeInitCapture(
          outputPath,
          feedRate,
          audioRecord.channelCount,
          isLive,
        )
      ) {
        Log.e(tag, "nativeInitCapture failed (sr=$feedRate ch=${audioRecord.channelCount})")
        return false
      }
      nativeInited = true
    }

    try {
      audioRecord.startRecording()
    } catch (e: IllegalStateException) {
      Log.e(tag, "startRecording rejected: ${e.message}")
      if (nativeInited) {
        runCatching { EkweNativeModule.nativeStopCapture() }
        nativeInited = false
      }
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
                if (nativeInited) EkweNativeModule.nativeFeedPcm(data, count)
                onPcm16k?.invoke(data, count)
                updateAmplitude(data, count)
              }
            } else {
              if (nativeInited) EkweNativeModule.nativeFeedPcm(buffer, read)
              val copy = buffer.copyOf(read)
              onPcm16k?.invoke(copy, read)
              updateAmplitude(copy, read)
            }
          } else if (read < 0) {
            Log.w(tag, "read returned $read")
            break
          }
        }

        // Flush any buffered downsampled audio collected during the final reads.
        flushDownsampleTail { data, count ->
          if (nativeInited) EkweNativeModule.nativeFeedPcm(data, count)
          onPcm16k?.invoke(data, count)
          updateAmplitude(data, count)
        }
      } catch (e: IllegalStateException) {
        Log.e(tag, "loop ended: ${e.message}")
      } catch (e: InterruptedException) {
        // normal stop path
      } finally {
        running = false
      }
    }
    return true
  }

  fun stop() {
    running = false
    runCatching { record?.stop() }
    val current = worker
    if (current != null && current !== Thread.currentThread()) {
      runCatching { current.join(750) }
    }
    worker = null
    runCatching { record?.release() }
    record = null
    if (nativeInited) {
      runCatching { EkweNativeModule.nativeStopCapture() }
      nativeInited = false
    }
    resetDownsampler()
  }
}
