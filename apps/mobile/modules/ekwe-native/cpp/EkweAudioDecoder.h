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
// Encodes PCM to Ogg Opus and writes to output_path.
// Extracts 60-point waveform.
// Uses libopusfile for .opus/.ogg files, miniaudio for everything else.
DecodeResult extract_audio_and_waveform(
    const std::string& input_path,
    const std::string& output_path);

// Memory-based audio decoder.
// Reads audio from in-memory buffer — no temp file needed.
// Same decode → Ogg Opus → waveform pipeline.
// `data` must remain valid for duration of call.
DecodeResult extract_audio_and_waveform_from_memory(
    const uint8_t* data,
    size_t data_size,
    const std::string& output_path);

// Takes raw PCM int16 data (already decoded by platform),
// encodes it to Ogg Opus, computes 60-point waveform.
// Used when platform's hardware decoder handles formats
// that miniaudio cannot (e.g. AAC/M4A on Android).
DecodeResult encode_pcm_to_opus(
    const int16_t* pcm_data,
    size_t num_samples,
    uint32_t sample_rate,
    uint16_t channels,
    const std::string& output_path);

} // namespace ekwe
