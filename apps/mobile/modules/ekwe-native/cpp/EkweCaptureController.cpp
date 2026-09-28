#include "EkweCaptureController.h"
#include "EkweAudioDecoder.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#if defined(__ANDROID__)
#include <android/log.h>
#define ALOG(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "EkveCtrl", fmt, ##__VA_ARGS__)
#else
#include <cstdio>
#define ALOG(fmt, ...) std::printf("[EkveCtrl] " fmt "\n", ##__VA_ARGS__)
#endif

namespace ekwe {

CaptureController::CaptureController(uint32_t sample_rate,
                                     uint16_t channels,
                                     const std::string& output_path,
                                     CaptureMode mode,
                                     bool enable_dc_filter)
    : ok_(false)
    , active_(false)
    , mode_(mode)
    , sample_rate_(sample_rate)
    , channels_(channels)
    , frame_size_(sample_rate / 50) // 20ms frames
    , frame_counter_(0)
    , total_samples_encoded_(0)
    , granule_position_(0)
    , granule_base_48k_(0)
    , current_rms_(0.0f)
    , dc_filter_enabled_(enable_dc_filter)
    , dc_blocker_prev_in_(0.0)
    , dc_blocker_prev_out_(0.0)
    , vad_silence_detected_(false)
    , consecutive_silence_frames_(0)
    , silence_frame_threshold_(400) // 8s at 20ms frames
    , preroll_frames_(0)
    , speech_started_(false)
    , opus_encoder_(sample_rate, channels, 10)
    , ogg_muxer_(output_path, sample_rate, 1)
    , staging_read_pos_(0)
    , staging_write_pos_(0)
{
    ALOG("constructor: sr=%d ch=%d mode=%d", sample_rate, channels, (int)mode);
    if (mode_ == CaptureMode::FILE && !opus_encoder_.is_ok()) {
        ALOG("constructor: opus encoder not ok");
        return;
    }
    if (mode_ == CaptureMode::FILE && !ogg_muxer_.is_ok()) {
        ALOG("constructor: ogg muxer not ok");
        return;
    }
    ALOG("constructor: ogg muxer ok");

    // Write Ogg Opus headers for file mode
    if (mode_ == CaptureMode::FILE) {
        // OpusHead pre-skip is expressed in 48 kHz samples (RFC 7845), but the
        // encoder reports lookahead at its own sample rate. Scale it so the
        // header, the granule base and libopusfile's duration math
        // (duration = granule - pre_skip) all agree.
        const int pre_skip_48k =
            static_cast<int>(static_cast<uint64_t>(opus_encoder_.lookahead()) * 48000 / sample_rate_);
        ALOG("constructor: pre_skip_48k=%d", pre_skip_48k);
        granule_base_48k_ = pre_skip_48k;
        if (!ogg_muxer_.write_opus_header(channels, pre_skip_48k, sample_rate)) {
            ALOG("constructor: write_opus_header failed");
            return;
        }
        ALOG("constructor: header written");
        if (!ogg_muxer_.write_opus_comment()) {
            ALOG("constructor: write_opus_comment failed");
            return;
        }
        ALOG("constructor: comment written");
    }

    active_ = true;
    ok_ = true;
    ALOG("constructor: SUCCESS");
}

CaptureController::~CaptureController() {
    if (active_) {
        stop();
    }
}

size_t CaptureController::reserve_staging(size_t needed) {
    if (needed > staging_buffer_.size()) {
        needed = staging_buffer_.size();
    }

    const size_t unread = staging_write_pos_ - staging_read_pos_;
    if (staging_write_pos_ + needed > staging_buffer_.size()) {
        if (unread > 0) {
            std::memmove(staging_buffer_.data(),
                         staging_buffer_.data() + staging_read_pos_,
                         unread * sizeof(int16_t));
        }
        staging_read_pos_ = 0;
        staging_write_pos_ = unread;
    }

    return staging_buffer_.size() - staging_write_pos_;
}

void CaptureController::process_staged_frames() {
    const size_t samples_per_frame = frame_size_ * channels_;
    while (staging_write_pos_ - staging_read_pos_ >= samples_per_frame) {
        process_frame(staging_buffer_.data() + staging_read_pos_, frame_size_);
        // If process_frame called stop() (e.g. VAD auto-stop), the buffer was
        // already consumed — exit immediately to avoid UB on invalid iterators.
        if (!active_) return;
        staging_read_pos_ += samples_per_frame;
    }
}

bool CaptureController::feed_pcm(const int16_t* data, size_t num_samples) {
    if (!ok_ || !active_) return false;

    // Loop rather than clipping: a caller may hand over more than the staging
    // buffer holds (a whole buffer from the platform callback, or a test
    // feeding a long take), and dropping the remainder would silently lose
    // audio mid-recording.
    while (num_samples > 0 && active_) {
        const size_t room = reserve_staging(num_samples);
        if (room == 0) break;

        const size_t chunk = num_samples < room ? num_samples : room;
        std::memcpy(staging_buffer_.data() + staging_write_pos_, data,
                    chunk * sizeof(int16_t));
        staging_write_pos_ += chunk;
        data += chunk;
        num_samples -= chunk;

        process_staged_frames();
    }

    return active_;
}

bool CaptureController::feed_pcm_float(const float* data, size_t num_samples) {
    if (!active_) return false;

    while (num_samples > 0 && active_) {
        const size_t room = reserve_staging(num_samples);
        if (room == 0) break;

        const size_t chunk = num_samples < room ? num_samples : room;
        int16_t* dest = staging_buffer_.data() + staging_write_pos_;
        for (size_t i = 0; i < chunk; ++i) {
            float sample = data[i];
            if (sample > 1.0f) sample = 1.0f;
            else if (sample < -1.0f) sample = -1.0f;
            dest[i] = sample >= 0.0f
                ? static_cast<int16_t>(sample * 32767.0f)
                : static_cast<int16_t>(sample * 32768.0f);
        }
        staging_write_pos_ += chunk;
        data += chunk;
        num_samples -= chunk;

        process_staged_frames();
    }

    return active_;
}

bool CaptureController::stop() {
    if (!active_) return false;
    active_ = false;

    // Flush the staging buffer, zero-padding the last partial frame.
    const size_t samples_per_frame = frame_size_ * channels_;
    while (staging_write_pos_ - staging_read_pos_ >= samples_per_frame) {
        process_frame(staging_buffer_.data() + staging_read_pos_, frame_size_);
        staging_read_pos_ += samples_per_frame;
    }

    const size_t tail = staging_write_pos_ - staging_read_pos_;
    if (tail > 0) {
        // Pad into scratch rather than into staging_buffer_. A call that fills
        // the buffer and leaves a partial frame behind leaves no room there, and
        // writing the pad in place overflows the array.
        std::vector<int16_t> padded(samples_per_frame, 0);
        std::memcpy(padded.data(),
                    staging_buffer_.data() + staging_read_pos_,
                    tail * sizeof(int16_t));
        process_frame(padded.data(), frame_size_);
        staging_read_pos_ = staging_write_pos_;
    }

    if (mode_ == CaptureMode::FILE) {
        // A take that never reached speech would finalize an Ogg with no
        // packets, which iOS cannot remux. Write the buffered lead-in so the
        // artifact is valid even when it is only silence.
        if (!speech_started_ && !preroll_.empty()) {
            flush_preroll();
        }
        ogg_muxer_.finalize();

        // Derive the waveform from the file we just finished writing, using the
        // same decode + waveform code the shared/imported path uses. The old
        // approach accumulated a per-frame RMS history during capture and
        // approximated a waveform from it, which cannot match a decoded file:
        // it blended peak and mean, floored every bin at 0.02, and was capped by
        // a fixed 9000-entry buffer that silently dropped the start of any long
        // recording. Re-reading the artifact is slower by one decode but is the
        // only way both paths can agree.
        //
        // A failure here is not fatal to the recording: the Ogg is already
        // finalized and valid, so stop() reports the waveform as unavailable
        // rather than discarding the user's audio.
        const DecodeResult analysis = analyze_audio_file(ogg_muxer_.path());
        if (analysis.success) {
            waveform_ = analysis.waveform;
        } else {
            ALOG("stop: waveform analysis failed: %s", analysis.error_message.c_str());
        }
    }

    emit_event(CaptureEvent::FINISHED);
    return true;
}

void CaptureController::process_frame(const int16_t* frame_data, size_t frame_samples) {
    // Compute RMS for metering
    double sum_sq = 0.0;
    size_t total = frame_samples * channels_;

    // Log first frames and then every 100 frames (2s)
    if (++frame_counter_ <= 5 || frame_counter_ % 100 == 0) {
        ALOG("process_frame: #%d total=%zu rms_before=%.4f", frame_counter_, total, current_rms_.load());
    }
    for (size_t i = 0; i < total; ++i) {
        double s = static_cast<double>(frame_data[i]);
        sum_sq += s * s;
    }
    current_rms_ = static_cast<float>(std::sqrt(sum_sq / total) / 32768.0);

    // Apply DC blocker and Normalize in a reusable local buffer
    static thread_local std::vector<int16_t> scratch_buffer;
    if (scratch_buffer.size() < total) scratch_buffer.resize(total);
    std::memcpy(scratch_buffer.data(), frame_data, total * sizeof(int16_t));

    if (dc_filter_enabled_) {
        apply_dc_blocker(scratch_buffer.data(), total);
    }
    normalize_volume(scratch_buffer.data(), total);

    // VAD: energy-based silence detection for the file-mode auto-stop
    double frame_energy = 0.0;
    for (size_t i = 0; i < total; ++i) {
        double s = static_cast<double>(std::abs(scratch_buffer[i]));
        frame_energy += s;
    }
    frame_energy /= total;

    bool is_speech_frame = frame_energy >= kVadThreshold;

    if (mode_ == CaptureMode::FILE) {
        // File mode auto-stop on 8s silence
        if (!is_speech_frame) {
            consecutive_silence_frames_++;
            if (consecutive_silence_frames_ >= silence_frame_threshold_ && !vad_silence_detected_) {
                vad_silence_detected_ = true;
                emit_event(CaptureEvent::VAD_SILENCE);
                stop();
                return;
            }
        } else {
            consecutive_silence_frames_ = 0;
        }
    }

    if (mode_ == CaptureMode::LIVE) {
        // The worker speaks PCM16 LE, and the capture session is already 16 kHz
        // mono, so the frame is forwarded as-is.
        emit_event(CaptureEvent::AUDIO_DATA,
                   reinterpret_cast<const uint8_t*>(scratch_buffer.data()),
                   total * sizeof(int16_t));
        return;
    }

    // FILE mode: hold the opening silence until the VAD hears speech.
    if (!speech_started_) {
        preroll_.insert(preroll_.end(), scratch_buffer.begin(),
                        scratch_buffer.begin() + total);
        preroll_frames_++;

        // The ring only needs to carry the onset, so anything older than
        // kPrerollMs is dropped as it arrives. Without this the whole lead-in
        // would be encoded whenever speech lands before the bound.
        const size_t cap = static_cast<size_t>(kPrerollMs) * sample_rate_ / 1000 * channels_;
        if (preroll_.size() > cap) {
            preroll_.erase(preroll_.begin(),
                           preroll_.begin() + (preroll_.size() - cap));
        }

        const int frame_ms = static_cast<int>(frame_samples * 1000 / sample_rate_);
        const bool onset_heard = is_speech_frame;
        const bool lead_in_spent =
            preroll_frames_ * frame_ms >= kLeadInMaxMs;

        if (!onset_heard && !lead_in_spent) return;

        // Either speech started, or we waited long enough that dropping the
        // silence is worth more than risking a clipped onset. Flush what the
        // ring kept, which carries the first syllable.
        flush_preroll();
        return;
    }

    encode_frame_to_ogg(scratch_buffer.data(), total);
}

void CaptureController::flush_preroll() {
    const size_t per_frame = frame_size_ * channels_;
    size_t offset = 0;
    while (offset + per_frame <= preroll_.size()) {
        encode_frame_to_ogg(preroll_.data() + offset, per_frame);
        offset += per_frame;
    }
    preroll_.clear();
    speech_started_ = true;
}

void CaptureController::encode_frame_to_ogg(const int16_t* data, size_t total) {
    std::vector<uint8_t> opus_packet;
    if (!opus_encoder_.encode_frame(data, total, opus_packet)) {
        emit_event(CaptureEvent::ERROR);
        return;
    }

    // Ogg Opus granule position must be in 48kHz sample units per RFC 6716
    total_samples_encoded_ += total / channels_;
    granule_position_ = granule_base_48k_ + static_cast<int64_t>(total_samples_encoded_) * 48000 / sample_rate_;
    ogg_muxer_.write_packet(opus_packet.data(), opus_packet.size(), granule_position_);
}

void CaptureController::emit_event(CaptureEvent event, const uint8_t* data, size_t size) {
    if (!callback_) return;
    CaptureEventData event_data;
    event_data.event = event;
    event_data.rms = current_rms_;
    if (data && size > 0) {
        event_data.data.assign(data, data + size);
    }
    callback_(event_data);
}

void CaptureController::apply_dc_blocker(int16_t* data, size_t num_samples) {
    const double R = 0.995;
    double prev_in = dc_blocker_prev_in_;
    double prev_out = dc_blocker_prev_out_;

    for (size_t i = 0; i < num_samples; ++i) {
        double in = static_cast<double>(data[i]);
        double out = in - prev_in + R * prev_out;
        data[i] = static_cast<int16_t>(std::max(-32768.0, std::min(32767.0, out)));
        prev_in = in;
        prev_out = out;
    }

    dc_blocker_prev_in_ = prev_in;
    dc_blocker_prev_out_ = prev_out;
}

void CaptureController::normalize_volume(int16_t* data, size_t num_samples) {
    // Target peak level: -3 dBFS (~22755) to leave headroom for clipping
    static constexpr double kTargetPeak = 22755.0;
    // Minimum gain to avoid amplifying silence/noise floor
    static constexpr double kMinGain = 0.5;
    // Maximum gain to prevent excessive noise amplification
    static constexpr double kMaxGain = 4.0;
    // Silence threshold: skip normalization for very quiet frames
    static constexpr double kSilenceThreshold = 500.0;

    // Find peak amplitude
    int peak = 0;
    for (size_t i = 0; i < num_samples; ++i) {
        int abs_val = std::abs(static_cast<int>(data[i]));
        if (abs_val > peak) peak = abs_val;
    }

    // Skip normalization for silence or near-silence
    if (peak < kSilenceThreshold) return;

    // Compute gain needed to reach target peak
    double gain = kTargetPeak / static_cast<double>(peak);
    gain = std::max(kMinGain, std::min(kMaxGain, gain));

    // Apply gain with soft limiting to prevent clipping
    for (size_t i = 0; i < num_samples; ++i) {
        double sample = static_cast<double>(data[i]) * gain;
        // Soft clip: tanh-like saturation for smooth limiting
        if (sample > 32767.0) {
            sample = 32767.0;
        } else if (sample < -32768.0) {
            sample = -32768.0;
        }
        data[i] = static_cast<int16_t>(sample);
    }
}

} // namespace ekwe
