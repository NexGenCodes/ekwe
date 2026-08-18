#include "EkweCaptureController.h"

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
                                     const std::string& caf_output_path,
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
    , vad_speech_debounce_(0)
    , vad_hangover_(0)
    , vad_speech_active_(false)
    , opus_encoder_(sample_rate, channels, 10)
    , ogg_muxer_(output_path, sample_rate, 1)
    , caf_muxer_(nullptr)
{
    ALOG("constructor: sr=%d ch=%d mode=%d", sample_rate, channels, (int)mode);
    if (!opus_encoder_.is_ok()) {
        ALOG("constructor: opus encoder not ok");
        return;
    }
    ALOG("constructor: opus encoder ok");
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

        // Sibling Opus-in-CAF for native iOS playback. Non-fatal: a failed CAF
        // just falls back to the remux path in JS (no .caf file → sibling check
        // misses). Pre-skip is expressed in 48 kHz samples for the CAF cookie.
        if (!caf_output_path.empty()) {
            const int caf_pre_skip =
                static_cast<int>(static_cast<uint64_t>(opus_encoder_.lookahead()) * 48000 / sample_rate_);
            caf_muxer_.reset(new CafMuxer(caf_output_path, 48000, channels));
            if (!caf_muxer_->write_opus_header(channels, caf_pre_skip, sample_rate_)) {
                ALOG("constructor: caf write_opus_header failed — continuing without CAF");
                caf_muxer_.reset();
            } else {
                ALOG("constructor: caf header written");
            }
        }
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

bool CaptureController::feed_pcm(const int16_t* data, size_t num_samples) {
    if (!ok_ || !active_) return false;

    // Accumulate samples in staging buffer
    staging_buffer_.insert(staging_buffer_.end(), data, data + num_samples);

    // Process complete frames
    size_t samples_per_frame = frame_size_ * channels_;
    while (staging_buffer_.size() >= samples_per_frame) {
        process_frame(staging_buffer_.data(), frame_size_);
        // If process_frame called stop() (e.g. VAD auto-stop), the buffer was
        // already consumed — exit immediately to avoid UB on invalid iterators.
        if (!active_) break;
        staging_buffer_.erase(
            staging_buffer_.begin(),
            staging_buffer_.begin() + static_cast<ptrdiff_t>(samples_per_frame)
        );
    }

    return true;
}

bool CaptureController::stop() {
    if (!active_) return false;
    active_ = false;

    // Flush remaining staging buffer (pad with silence)
    if (!staging_buffer_.empty()) {
        size_t samples_per_frame = frame_size_ * channels_;
        size_t needed = samples_per_frame - staging_buffer_.size();
        staging_buffer_.resize(samples_per_frame, 0);
        process_frame(staging_buffer_.data(), frame_size_);
        staging_buffer_.clear();
    }

    if (mode_ == CaptureMode::FILE) {
        ogg_muxer_.finalize();
        if (caf_muxer_) {
            caf_muxer_->finalize();
            caf_muxer_.reset();
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
    rms_history_.push_back(current_rms_);

    if (rms_history_.size() > 9000) {
        std::vector<float> downsampled;
        downsampled.reserve(4500);
        for (size_t i = 0; i < rms_history_.size() - 1; i += 2) {
            downsampled.push_back(std::max(rms_history_[i], rms_history_[i+1]));
        }
        rms_history_ = std::move(downsampled);
    }

    // Apply DC blocker
    std::vector<int16_t> processed_data;
    const int16_t* process_ptr = frame_data;
    if (dc_filter_enabled_) {
        processed_data.assign(frame_data, frame_data + total);
        apply_dc_blocker(processed_data.data(), total);
        process_ptr = processed_data.data();
    }

    // Normalize volume for consistent audio levels
    if (process_ptr == processed_data.data()) {
        normalize_volume(processed_data.data(), total);
    } else {
        processed_data.assign(frame_data, frame_data + total);
        normalize_volume(processed_data.data(), total);
        process_ptr = processed_data.data();
    }

    // VAD: energy-based with hysteresis (both modes)
    double frame_energy = 0.0;
    for (size_t i = 0; i < total; ++i) {
        double s = static_cast<double>(std::abs(process_ptr[i]));
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
    } else {
        // Live mode VAD: hysteresis to suppress silence during Nigerian noise
        if (is_speech_frame) {
            if (vad_speech_debounce_ < kSpeechDebounceMax) {
                vad_speech_debounce_++;
            }
            vad_hangover_ = kHangoverMax;
        } else {
            if (vad_speech_debounce_ > 0) {
                vad_speech_debounce_--;
            }
            if (vad_hangover_ > 0) {
                vad_hangover_--;
            }
        }

        vad_speech_active_ = vad_speech_debounce_ >= kSpeechDebounceMax;

        if (!vad_speech_active_ && vad_hangover_ <= 0) {
            // Still encode to maintain encoder lookahead continuity, but suppress emit
            std::vector<uint8_t> dummy;
            opus_encoder_.encode_frame(process_ptr, total, dummy);
            total_samples_encoded_ += frame_samples;
            granule_position_ = granule_base_48k_ + static_cast<int64_t>(total_samples_encoded_) * 48000 / sample_rate_;
            return;
        }
    }

    std::vector<uint8_t> opus_packet;
    if (!opus_encoder_.encode_frame(process_ptr, total, opus_packet)) {
        emit_event(CaptureEvent::ERROR);
        return;
    }

    total_samples_encoded_ += frame_samples;
    // Ogg Opus granule position must be in 48kHz sample units per RFC 6716
    granule_position_ = granule_base_48k_ + static_cast<int64_t>(total_samples_encoded_) * 48000 / sample_rate_;

    if (mode_ == CaptureMode::FILE) {
        ogg_muxer_.write_packet(opus_packet.data(), opus_packet.size(), granule_position_);
        if (caf_muxer_) {
            // Each packet covers exactly one 20ms frame; in 48 kHz units that's
            // frame_size * 48000 / sample_rate (960 at 16 kHz).
            const uint64_t caf_frames =
                static_cast<uint64_t>(frame_size_) * 48000 / sample_rate_;
            caf_muxer_->write_packet(opus_packet.data(), opus_packet.size(), caf_frames);
        }
    } else {
        emit_event(CaptureEvent::AUDIO_DATA, opus_packet.data(), opus_packet.size());
    }
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
    int16_t peak = 0;
    for (size_t i = 0; i < num_samples; ++i) {
        int16_t abs_val = std::abs(data[i]);
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

std::vector<float> CaptureController::get_waveform(size_t num_bins) const {
    if (rms_history_.empty() || num_bins == 0) return {};
    std::vector<float> out(num_bins);
    float mx = 0.001f;
    for (size_t i = 0; i < num_bins; i++) {
        size_t lo = (i * rms_history_.size()) / num_bins;
        size_t hi = std::max(lo + 1, ((i + 1) * rms_history_.size()) / num_bins);
        if (hi > rms_history_.size()) hi = rms_history_.size();
        float sum = 0, pk = 0;
        for (size_t j = lo; j < hi; j++) {
            float v = rms_history_[j];
            sum += v;
            if (v > pk) pk = v;
        }
        float blended = (pk + sum / (float)(hi - lo)) / 2.0f;
        if (blended > mx) mx = blended;
        out[i] = blended;
    }
    for (auto& v : out) {
        v = std::min(1.0f, std::max(0.02f, v / mx));
    }
    return out;
}

} // namespace ekwe
