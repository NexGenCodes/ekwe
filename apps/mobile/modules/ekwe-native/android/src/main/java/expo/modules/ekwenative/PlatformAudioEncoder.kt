package expo.modules.ekwenative

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.util.Arrays

/**
 * Encodes 16-bit PCM into an M4A/AAC-LC playback copy (MediaCodec +
 * MediaMuxer). AAC-LC is decodable on every Android device, so the `.m4a` is
 * playable even by other apps that could not open Ogg Opus.
 */
object PlatformAudioEncoder {
    private const val TAG = "PlatformAudioEncoder"
    private const val AAC_FRAME_SAMPLES = 1024 // AAC frames span 1024 PCM frames per channel
    private const val MIME = "audio/mp4a-latm"
    private const val TIMEOUT_US = 10_000L
    private const val BIT_RATE = 32_000

    private class WavInfo(
        val sampleRate: Int,
        val channels: Int,
        val dataOffset: Long,
        val dataByteSize: Long,
    )

    fun encodeWavToM4a(wavPath: String, m4aPath: String): Boolean {
        val file = File(wavPath)
        if (!file.exists() || file.length() < 44) return false

        val headerBuf = ByteArray(4096)
        val header = try {
            FileInputStream(file).use { it.read(headerBuf) }
        } catch (e: Exception) {
            Log.w(TAG, "readable", e)
            -1
        }
        if (header < 12) return false
        val info = parseWavHeader(headerBuf, header) ?: return false

        return try {
            FileInputStream(file).use { input ->
                encodePcm(input, info.dataOffset, info.dataByteSize, info.sampleRate, info.channels, m4aPath)
            }
        } catch (e: Exception) {
            Log.w(TAG, "encodeWavToM4a failed for $wavPath", e)
            false
        }
    }

    fun encodePcmToM4a(pcm: ShortArray, sampleRate: Int, channels: Int, m4aPath: String): Boolean {
        if (pcm.isEmpty()) return false
        // Reinterpret the little-endian int16 samples without copying.
        val buffer = ByteBuffer.allocate(pcm.size * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        buffer.asShortBuffer().put(pcm)
        val bytes = buffer.array()
        return try {
            ByteArrayInputStream(bytes).use { encodePcm(it, 0, bytes.size.toLong(), sampleRate, channels, m4aPath) }
        } catch (e: Exception) {
            Log.w(TAG, "encodePcmToM4a failed for $m4aPath", e)
            false
        }
    }

    private fun parseWavHeader(bytes: ByteArray, length: Int): WavInfo? {
        if (length < 12) return null
        if (String(bytes, 0, 4, Charsets.US_ASCII) != "RIFF") return null
        if (String(bytes, 8, 4, Charsets.US_ASCII) != "WAVE") return null

        var off = 12
        var sampleRate = 0
        var channels = 0
        var bitsPerSample = 16
        var dataOffset = -1L
        var dataSize = -1L

        while (off + 8 <= length) {
            val id = String(bytes, off, 4, Charsets.US_ASCII)
            val size = leInt(bytes, off + 4)
            when (id) {
                "fmt " -> {
                    channels = leShort(bytes, off + 10)
                    sampleRate = leInt(bytes, off + 12)
                    bitsPerSample = leShort(bytes, off + 22)
                }
                "data" -> {
                    dataOffset = off + 8L
                    dataSize = size.toLong()
                    break
                }
            }
            off += 8 + size
        }

        // Only 16-bit PCM is produced by the C++ WAV bridge.
        if (dataOffset < 0 || bitsPerSample != 16 || sampleRate <= 0 || channels <= 0) return null
        return WavInfo(sampleRate, channels, dataOffset, dataSize)
    }

    private fun encodePcm(
        input: InputStream,
        dataOffset: Long,
        dataSize: Long,
        sampleRate: Int,
        channels: Int,
        m4aPath: String,
    ): Boolean {
        val frameBytes = AAC_FRAME_SAMPLES * channels * 2
        val format = MediaFormat.createAudioFormat(MIME, sampleRate, channels)
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        format.setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, frameBytes * 4)

        val codec = try {
            MediaCodec.createEncoderByType(MIME)
        } catch (e: Exception) {
            Log.w(TAG, "no AAC-LC encoder", e)
            return false
        }
        var muxer: MediaMuxer? = null
        var trackIndex = -1
        var muxerStarted = false
        var outputEos = false
        val bufferInfo = MediaCodec.BufferInfo()

        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            muxer = MediaMuxer(m4aPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            // Skip the WAV header out of the stream.
            var skipped = 0L
            while (skipped < dataOffset && !outputEos) {
                val n = input.skip(dataOffset - skipped)
                if (n <= 0) {
                    if (input.read() == -1) break
                    skipped += 1
                } else {
                    skipped += n
                }
            }

            val staging = ByteArray(frameBytes * 2)
            val pending = ByteArray(frameBytes)
            var pendingCount = 0
            var remaining = dataSize
            var eof = false
            var eosQueued = false
            var ptsUs = 0L

            val topUp = {
                while (pendingCount < frameBytes && !eof && remaining > 0) {
                    val want = minOf(staging.size, frameBytes - pendingCount, remaining.toInt())
                    val n = input.read(staging, 0, want)
                    if (n < 0) { eof = true } else {
                        System.arraycopy(staging, 0, pending, pendingCount, n)
                        pendingCount += n
                        remaining -= n
                    }
                }
                if (remaining <= 0) eof = true
                if (eof && pendingCount in 1 until frameBytes) {
                    // Pad a trailing partial frame with silence so the encoder
                    // always receives whole AAC frames.
                    Arrays.fill(pending, pendingCount, frameBytes, 0)
                    pendingCount = frameBytes
                    remaining = 0
                }
            }

            fun drain(timeoutUs: Long) {
                while (true) {
                    val outIndex = codec.dequeueOutputBuffer(bufferInfo, timeoutUs)
                    when (outIndex) {
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            trackIndex = muxer.addTrack(codec.outputFormat)
                            if (!muxerStarted) {
                                muxer.start()
                                muxerStarted = true
                            }
                        }
                        MediaCodec.INFO_TRY_AGAIN_LATER -> return
                        else -> if (outIndex >= 0) {
                            val outBuf = codec.getOutputBuffer(outIndex) ?: continue
                            val isConfig =
                                bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                            if (bufferInfo.size > 0 && !isConfig && muxerStarted) {
                                outBuf.position(bufferInfo.offset)
                                outBuf.limit(bufferInfo.offset + bufferInfo.size)
                                muxer.writeSampleData(trackIndex, outBuf, bufferInfo)
                            }
                            codec.releaseOutputBuffer(outIndex, false)
                            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                outputEos = true
                                return
                            }
                        }
                    }
                }
            }

            while (!eosQueued && !outputEos) {
                topUp()
                if (pendingCount == 0 && eof) {
                    val inIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex < 0) continue
                    val inBuf = codec.getInputBuffer(inIndex) ?: continue
                    inBuf.clear()
                    codec.queueInputBuffer(inIndex, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                    eosQueued = true
                } else {
                    val inIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex < 0) continue
                    val inBuf = codec.getInputBuffer(inIndex) ?: continue
                    inBuf.clear()
                    inBuf.put(pending, 0, pendingCount)
                    ptsUs += pendingCount.toLong() / 2 / channels * 1_000_000L / sampleRate
                    val flags = if (eof) MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0
                    codec.queueInputBuffer(inIndex, 0, pendingCount, ptsUs, flags)
                    pendingCount = 0
                    if (eof) eosQueued = true
                }
                drain(0L)
            }
            // Block up to TIMEOUT_US on each dequeue instead of spinning with
            // Thread.sleep(5): the wait happens inside dequeueOutputBuffer, so a
            // ready buffer is returned immediately and only the genuinely idle
            // wait takes the full timeout.
            while (!outputEos) {
                drain(TIMEOUT_US)
            }
        } catch (e: Exception) {
            Log.w(TAG, "encodePcm failed for $m4aPath", e)
            return false
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            if (muxer != null) {
                try {
                    if (muxerStarted) muxer.stop()
                } catch (_: Exception) {
                }
                muxer.release()
            }
        }
        return outputEos && muxerStarted && trackIndex >= 0
    }

    private fun leShort(bytes: ByteArray, offset: Int): Int {
        val low = bytes[offset].toInt() and 0xFF
        val high = bytes[offset + 1].toInt() and 0xFF
        return low or (high shl 8)
    }

    private fun leInt(bytes: ByteArray, offset: Int): Int {
        var v = 0
        for (i in 0..3) {
            v = v or ((bytes[offset + i].toInt() and 0xFF) shl (8 * i))
        }
        return v
    }
}