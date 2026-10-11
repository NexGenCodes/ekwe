#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <array>
#include <functional>
#include <atomic>

#include "EkweOpusEncoder.h"
#include "EkweOggMuxer.h"
#include "EkweCallbackSlot.hpp"

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
    // Non-owning view valid only for the duration of the callback. The frame
    // bytes are handed to a synchronous listener, so copying them into the
    // event would just allocate per audio frame.
    ByteView data;
    std::string error_message;
    float rms;
};

using CaptureCallback = std::function<void(const CaptureEventData&)>;

class CaptureController {
public:
    // output_path: Ogg Opus destination (the single recorded artifact). In FILE
    // mode every packet is written into it and nothing else is produced — iOS
    // derives its own M4A playback copy on demand, so no sibling file is
    // written during capture.
    CaptureController(uint32_t sample_rate,
                      uint16_t channels,
                      const std::string& output_path,
                      CaptureMode mode,
                      bool enable_dc_filter = true);
    ~CaptureController();

    bool is_ok() const { return ok_; }
    bool is_active() const { return active_; }

    void set_callback(CaptureCallback cb) { callback_ = std::move(cb); }

    bool feed_pcm(const int16_t* data, size_t num_samples);
    bool feed_pcm_float(const float* data, size_t num_samples);

    bool stop();

    float rms() const { return current_rms_; }

    // Waveform of the finished recording, derived in stop() by decoding the
    // finalized Ogg through the same code the shared/imported path uses. Empty
    // when nothing was captured, or in LIVE mode where no file is written.
    const std::vector<float>& waveform() const { return waveform_; }

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
    std::vector<float> waveform_;

    bool dc_filter_enabled_;
    double dc_blocker_prev_in_;
    double dc_blocker_prev_out_;

    // Smoothed AGC envelope follower
    double agc_envelope_;

    // VAD state, for the file-mode auto-stop
    static constexpr double kVadThreshold = 600.0;  // ~1.8% RMS, tuned for generator/street noise
    bool vad_silence_detected_;
    int consecutive_silence_frames_;
    int silence_frame_threshold_;

    // Leading-silence gate. FILE mode holds frames instead of encoding them
    // until the same kVadThreshold hears speech, so a recording does not open
    // with dead air. The ring keeps enough audio to preserve the onset of the
    // word that tripped it, and the lead-in bound stops a quiet speaker from
    // losing their whole take.
    static constexpr int kPrerollMs = 500;
    static constexpr int kLeadInMaxMs = 2000;
    std::vector<int16_t> preroll_;
    int preroll_frames_;
    bool speech_started_;

    // Trailing-silence gate, the mirror of the preroll. A silent frame is
    // buffered rather than encoded, so silence only reaches the Ogg when speech
    // follows it. Without this, dictation padded by thinking pauses (and the
    // 8s auto-stop path in particular) ends on a long flat run of zeros, which
    // a voice note renders as the dead, straight-line waveform the whole point
    // of the shared file is to avoid. stop() drops whatever is still pending.
    static constexpr int kTailSilenceMs = 500;
    std::vector<int16_t> tail_silence_;


    OpusStreamEncoder opus_encoder_;
    OggMuxer ogg_muxer_;

    CaptureCallback callback_;

    std::array<int16_t, 8192> staging_buffer_;
    size_t staging_read_pos_;
    size_t staging_write_pos_;
    std::vector<int16_t> scratch_buffer_;

    void apply_dc_blocker(int16_t* data, size_t num_samples);
    void normalize_volume(int16_t* data, size_t num_samples);
    void process_frame(const int16_t* frame_data, size_t frame_samples);
    void encode_frame_to_ogg(const int16_t* data, size_t total);
    void flush_preroll();
    // Encodes the buffered trailing silence, because speech resumed.
    void flush_tail_silence();
    void process_staged_frames();
    // Compacts the staging buffer so at least `needed` samples fit, and reports
    // how many actually do. Callers loop on this instead of clipping their
    // input, so a call larger than the buffer is consumed rather than truncated.
    size_t reserve_staging(size_t needed);
    void emit_event(CaptureEvent event, const uint8_t* data = nullptr, size_t size = 0);
};

} // namespace ekwe
