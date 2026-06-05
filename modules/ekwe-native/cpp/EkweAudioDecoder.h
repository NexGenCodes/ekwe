#pragma once

#include <string>
#include <vector>

namespace ekwe {

struct DecodeResult {
    bool success;
    std::string error_message;
    int duration_ms;
    std::vector<float> waveform;
};

// Unified decoding function.
// Takes any audio file path (input_path) and decodes it to PCM.
// Encodes the PCM to FLAC and writes to output_path.
// Extracts a 60-point waveform.
// Uses libopusfile for .opus/.ogg files, and miniaudio for everything else.
DecodeResult extract_audio_and_waveform(const std::string& input_path, const std::string& output_path);

// Takes raw PCM int16 data (already decoded by the platform, e.g. Android MediaCodec),
// encodes it to FLAC, computes a 60-point waveform, and returns the result.
// This bypasses miniaudio entirely — used when the platform's hardware decoder
// handles formats that miniaudio cannot (e.g. AAC/M4A on Android).
DecodeResult encode_pcm_to_flac(const int16_t* pcm_data, size_t num_samples,
                                uint32_t sample_rate, uint16_t channels,
                                const std::string& output_path);

} // namespace ekwe
