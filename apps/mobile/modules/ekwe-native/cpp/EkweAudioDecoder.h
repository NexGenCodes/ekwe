#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <cstddef>

namespace ekwe {

// Default fallback for the max input size, used only when a caller does not
// pass the shared limit explicitly. The authoritative value lives in
// @ekwe/shared/plans (PREMIUM_LIMITS.maxAudioBytes) and is passed down from JS
// through the native bridges at call time.
constexpr size_t kDefaultMaxAudioBytes = 25 * 1024 * 1024; // 26,214,400

// Upper bound on decoded PCM samples (mono). Guards against decompression-bomb
// / very long sources that a small compressed file can expand into (e.g. hours
// of low-bitrate Opus), preventing an accidental OOM while decoding.
constexpr size_t kMaxDecodedSamples = 16000 * 60 * 30; // 30 min @ 16 kHz

// RFC 7845: Ogg Opus granule positions are always measured in 48 kHz samples,
// independent of the encoder's input sample rate (which may be 16 kHz).
constexpr int32_t kOpusGranuleRate = 48000;

struct DecodeResult {
    bool success;
    std::string error_message;
    int duration_ms;
    std::vector<float> waveform;
};

// File-based audio decoder.
// Takes any audio file path and decodes it to PCM.
// Produces a 16 kHz mono Ogg Opus at output_path — reusing the source
// verbatim when it is already 16 kHz mono Ogg Opus (no transcode).
// Extracts 60-point waveform.
// Uses libopusfile for .opus/.ogg files, miniaudio for everything else.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult transcode_audio_to_opus(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Memory-based audio decoder.
// Reads audio from in-memory buffer — no temp file needed.
// Same decode → Ogg Opus → waveform pipeline (with source reuse fast-path).
// `data` must remain valid for duration of call.
// `max_audio_bytes` caps the buffer size (comes from @ekwe/shared/plans).
DecodeResult transcode_audio_to_opus_from_memory(
    const uint8_t* data,
    size_t data_size,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Decodes any audio file into a standalone PCM WAV file (no re-encode).
// Ogg Opus is decoded via libopusfile at 48 kHz mono; everything else is
// decoded via miniaudio at 16 kHz mono — matching the decode stage of
// transcode_audio_to_opus. Used by the iOS app to make recorded Opus playable
// through AVPlayer/expo-audio, which has no native Ogg Opus support.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult decode_audio_to_wav(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Decodes any audio file into an Opus-in-CAF file (no WAV re-encode).
// Ogg Opus sources are remuxed packet-for-packet into the CAF container
// (lossless container change — no decode/re-encode), everything else is
// decoded via miniaudio then re-encoded to Opus. CAF is Apple's native
// compressed container; Opus-in-CAF is supported by iOS AVPlayer/AVAudioPlayer
// (iOS 11+) where the Ogg container is not.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult decode_audio_to_caf(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

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
