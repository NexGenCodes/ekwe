#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace ekwe {

struct DecodeResult {
    bool success;
    std::string error_message;
    int duration_ms;
    std::vector<float> waveform;
};

// File-based audio decoder.
// Takes any audio file path and decodes it to PCM.
// Encodes PCM to FLAC and writes to output_path.
// Extracts 60-point waveform.
// Uses libopusfile for .opus/.ogg files, miniaudio for everything else.
DecodeResult extract_audio_and_waveform(
    const std::string& input_path,
    const std::string& output_path);

// Memory-based audio decoder.
// Reads audio from in-memory buffer — no temp file needed.
// Same decode → FLAC → waveform pipeline.
// `data` must remain valid for duration of call.
DecodeResult extract_audio_and_waveform_from_memory(
    const uint8_t* data,
    size_t data_size,
    const std::string& output_path);

// Takes raw PCM int16 data (already decoded by platform),
// encodes it to FLAC, computes 60-point waveform.
// Used when platform's hardware decoder handles formats
// that miniaudio cannot (e.g. AAC/M4A on Android).
DecodeResult encode_pcm_to_flac(
    const int16_t* pcm_data,
    size_t num_samples,
    uint32_t sample_rate,
    uint16_t channels,
    const std::string& output_path);

// ─── Streaming FLAC Encoder ──────────────────────────────────────
// For AudioRecord → FLAC pipeline.
// Feed PCM chunks incrementally with feed_pcm() during recording,
// call finalize() when recording stops to finish the FLAC file.
// Accumulates PCM internally for waveform computation.

class FlacStreamEncoder {
public:
    FlacStreamEncoder(const std::string& output_path,
                      uint32_t sample_rate,
                      uint16_t channels,
                      bool enable_dc_filter = true);
    ~FlacStreamEncoder();

    bool is_ok() const { return ok_; }
    bool feed_pcm(const int16_t* data, size_t num_samples);
    DecodeResult finalize();

private:
    bool ok_;
    void* encoder_;               // FLAC__StreamEncoder* (opaque)
    std::vector<int16_t> pcm_accumulator_;
    uint32_t sample_rate_;
    uint16_t channels_;
    bool finalized_;
    bool dc_filter_enabled_;

    // First-order DC blocker state (high-pass ~80Hz at 16kHz)
    double dc_blocker_prev_in_;
    double dc_blocker_prev_out_;
    std::vector<int16_t> dc_filter_scratch_;  // reusable buffer, avoids per-call alloc
    std::vector<int32_t> flac_buffer_;    // reusable int32 buffer, avoids per-call alloc

    void apply_dc_blocker(int16_t* data, size_t num_samples);

    FlacStreamEncoder(const FlacStreamEncoder&) = delete;
    FlacStreamEncoder& operator=(const FlacStreamEncoder&) = delete;
};

} // namespace ekwe
