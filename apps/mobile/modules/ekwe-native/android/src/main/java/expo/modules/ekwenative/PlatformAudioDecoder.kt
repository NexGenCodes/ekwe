package expo.modules.ekwenative

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.util.Log
import java.nio.ByteBuffer

/**
 * Decodes audio the C++ core doesn't handle itself (MP3/AAC/ADTS, M4A, FLAC,
 * AMR, 3GP, WebM) through the platform decoder, producing raw PCM int16 that
 * encodePcmToOpusJNI normalises to the 16 kHz mono contract.
 * Returns null when the platform cannot decode the input.
 */
object PlatformAudioDecoder {

    class PcmResult(val samples: ShortArray, val sampleRate: Int, val channels: Int, val durationMs: Int)

    // Backstop so a broken provider cannot stream unbounded audio into memory;
    // the plan-tier duration gate normally stops far earlier.
    private const val MAX_SAMPLE_TIME_MS = 30 * 60 * 1000L

    fun decode(context: Context, uri: Uri, durationCeilingMs: Long): PcmResult? {
        val extractor = MediaExtractor()
        try {
            try {
                extractor.setDataSource(context, uri, null)
            } catch (e: Exception) {
                Log.w("PlatformAudioDecoder", "setDataSource failed for $uri", e)
                return null
            }
            var trackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("audio/")) {
                    trackIndex = i
                    break
                }
            }
            if (trackIndex < 0) {
                Log.w("PlatformAudioDecoder", "no audio track in $uri")
                return null
            }
            extractor.selectTrack(trackIndex)
            val inputFormat = extractor.getTrackFormat(trackIndex)
            val mime = inputFormat.getString(MediaFormat.KEY_MIME) ?: return null
            val decoder = try {
                MediaCodec.createDecoderByType(mime)
            } catch (e: Exception) {
                Log.w("PlatformAudioDecoder", "no decoder for $mime", e)
                return null
            }

            return try {
                inputFormat.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
                decoder.configure(inputFormat, null, null, 0)
                decoder.start()

                val collected = ArrayList<Short>()
                val info = MediaCodec.BufferInfo()
                var sawInputEOS = false
                var decoderEOS = false
                val startUs = System.currentTimeMillis()
                var sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE, 0)
                var channels = 1

                while (!decoderEOS) {
                    if (!sawInputEOS) {
                        val inIndex = decoder.dequeueInputBuffer(10_000L)
                        if (inIndex >= 0) {
                            val buffer = decoder.getInputBuffer(inIndex)
                            val read = extractor.readSampleData(buffer!!, 0)
                            if (read < 0) {
                                decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                sawInputEOS = true
                            } else {
                                decoder.queueInputBuffer(inIndex, 0, read, extractor.sampleTime, 0)
                                extractor.advance()
                            }
                        }
                    }
                    val outIndex = decoder.dequeueOutputBuffer(info, 10_000L)
                    when {
                        outIndex >= 0 -> {
                            if (info.size > 0) {
                                val out = decoder.getOutputBuffer(outIndex)!!
                                out.position(info.offset)
                                out.limit(info.offset + info.size)
                                val encoding = decoder.outputFormat.getInteger(
                                    MediaFormat.KEY_PCM_ENCODING,
                                    AudioFormat.ENCODING_PCM_16BIT,
                                )
                                if (encoding != AudioFormat.ENCODING_PCM_16BIT) {
                                    Log.w("PlatformAudioDecoder", "unexpected PCM encoding $encoding")
                                    return null
                                }
                                sampleRate = decoder.outputFormat.getInteger(
                                    MediaFormat.KEY_SAMPLE_RATE, sampleRate)
                                channels = decoder.outputFormat.getInteger(
                                    MediaFormat.KEY_CHANNEL_COUNT, channels)
                                val shortBuffer = out.asShortBuffer()
                                val count = info.size / 2
                                for (i in 0 until count) {
                                    collected.add(shortBuffer.get(i))
                                }
                                val framesMs =
                                    (collected.size.toLong() / maxOf(1, channels)) * 1000L / maxOf(1, sampleRate)
                                if (framesMs > MAX_SAMPLE_TIME_MS || framesMs > durationCeilingMs) {
                                    Log.w("PlatformAudioDecoder", "PCM over duration ceiling ($framesMs ms)")
                                    return null
                                }
                            }
                            decoder.releaseOutputBuffer(outIndex, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                decoderEOS = true
                            }
                        }
                        outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                            if (System.currentTimeMillis() - startUs > 30000) {
                                Log.w("PlatformAudioDecoder", "decode stalled")
                                return null
                            }
                        }
                        outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            sampleRate = decoder.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE, sampleRate)
                            channels = decoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT, channels)
                        }
                    }
                }
                if (collected.isEmpty()) return null
                val arr = ShortArray(collected.size)
                for (i in arr.indices) arr[i] = collected[i]
                val durationMs = ((arr.size.toLong() / maxOf(1, channels)) * 1000L / maxOf(1, sampleRate)).toInt()
                PcmResult(arr, sampleRate, channels, durationMs)
            } finally {
                try {
                    decoder.stop()
                } catch (_: IllegalStateException) {}
                decoder.release()
            }
        } finally {
            extractor.release()
        }
    }
}
