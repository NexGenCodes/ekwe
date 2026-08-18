#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <functional>
#include <atomic>
#include <memory>

#include "EkweOpusEncoder.h"
#include "EkweOggMuxer.h"
#include "EkweCafMuxer.h"

namespace ekwe {

enum class CaptureMode {
    FILE,
    LIVE,
};

enum class CaptureEvent {
    AUDIO_DATA,
    VAD_SILENCE,
    ERROR,
    FINISHED,
};

struct CaptureEventData {
    CaptureEvent event;
    std::vector<uint8_t> data;
    std::string error_message;
    float rms;
};

using CaptureCallback = std::function<void(const CaptureEventData&)>;

class CaptureController {
public:
    // output_path: Ogg Opus destination. caf_output_path: optional sibling
    // Opus-in-CAF destination (iOS-native playback) — when non-empty and mode
    // is FILE, every packet is also written into the CAF container. Android
    // passes an empty string (ExoPlayer plays Ogg natively).
    CaptureController(uint32_t sample_rate,
                      uint16_t channels,
                      const std::string& output_path,
                      const std::string& caf_output_path,
                      CaptureMode mode,
                      bool enable_dc_filter = true);
    ~CaptureController();

    bool is_ok() const { return ok_; }
    bool is_active() const { return active_; }

    void set_callback(CaptureCallback cb) { callback_ = std::move(cb); }

    bool feed_pcm(const int16_t* data, size_t num_samples);

    bool stop();

    float rms() const { return current_rms_; }

    std::vector<float> get_waveform(size_t num_bins) const;

    CaptureController(const CaptureController&) = delete;
    CaptureController& operator=(const CaptureController&) = delete;

private:
    bool ok_;
    std::atomic<bool> active_;
    CaptureMode mode_;
    uint32_t sample_rate_;
    uint16_t channels_;
    uint32_t frame_size_;
    int frame_counter_;
    uint64_t total_samples_encoded_;
    int64_t granule_position_;
    // Opus pre-skip in 48 kHz sample units (RFC 7845). The granule position of
    // each page must count ALL decoded samples including pre-skip, so every
    // computed granule adds this base to the elapsed output.
    int64_t granule_base_48k_;
    std::atomic<float> current_rms_;
    std::vector<float> rms_history_;

    bool dc_filter_enabled_;
    double dc_blocker_prev_in_;
    double dc_blocker_prev_out_;

    // VAD state (both modes)
    bool vad_silence_detected_;
    int consecutive_silence_frames_;
    int silence_frame_threshold_;

    // VAD hysteresis for live mode (Nigerian noise conditions)
    static constexpr int kSpeechDebounceMax = 1;   // 20ms — start as soon as speech is detected
    static constexpr int kHangoverMax = 15;         // 300ms — natural conversational pause buffer
    static constexpr double kVadThreshold = 600.0;  // ~1.8% RMS, tuned for generator/street noise
    int vad_speech_debounce_;
    int vad_hangover_;
    bool vad_speech_active_;

    OpusStreamEncoder opus_encoder_;
    OggMuxer ogg_muxer_;
    std::unique_ptr<CafMuxer> caf_muxer_;

    CaptureCallback callback_;

    std::vector<int16_t> staging_buffer_;

    void apply_dc_blocker(int16_t* data, size_t num_samples);
    void normalize_volume(int16_t* data, size_t num_samples);
    void process_frame(const int16_t* frame_data, size_t frame_samples);
    void emit_event(CaptureEvent event, const uint8_t* data = nullptr, size_t size = 0);
};

} // namespace ekwe
