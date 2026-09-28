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

// Hard ceiling on decoded audio *duration*, independent of sample rate.
// Expressed in time rather than sample count so a 48 kHz source cannot consume
// memory 3x faster than a 16 kHz one while hitting the same nominal limit.
// Guards against decompression bombs and very long sources that a small
// compressed file can expand into (e.g. hours of low-bitrate Opus).
constexpr int kMaxAudioDurationMs = 30 * 60 * 1000; // 30 min

// RFC 7845: Ogg Opus granule positions are always measured in 48 kHz samples,
// independent of the encoder's input sample rate (which may be 16 kHz).
constexpr int32_t kOpusGranuleRate = 48000;

// The decode contract for every path in this module: mono PCM at a sample rate
// the Opus encoder can legally accept (8/12/16/24/48 kHz).
//
// Every path here normalises to mono. Sources that are multi-channel (provider
// TTS commonly ships stereo) are downmixed rather than trusted, because
// trusting a per-source channel count is what previously made duration,
// waveform, and re-encode disagree with each other.
//
// Ogg Opus sources always decode at 48 kHz. The vendored libopusfile creates
// its decoder with a hardcoded 48000 (opus_multistream_decoder_create(48000, …)
// in thirdparty/opusfile/src/opusfile.c) and predates
// op_set_decoding_sample_rate(), so OpusHead.input_sample_rate cannot be
// honoured: op_read() and op_pcm_total() both count 48 kHz samples no matter
// what the stream declares. Tagging those samples with the declared rate is
// exactly the kind of silent lie this contract exists to prevent — it made a
// 1.5 s recording report 4.5 s and re-encoded such a file stretched 3x with
// the pitch dragged down an octave and change. 48 kHz is both what the samples
// actually are and a rate the encoder accepts.
//
// miniaudio sources (WAV/MP3/M4A/…) are resampled down to the recorder rate as
// part of decoding, so those land at 16 kHz mono instead.
constexpr uint16_t kTargetChannels = 1;
constexpr uint32_t kRecorderSampleRate = 16000;
constexpr uint32_t kOpusDecodeSampleRate = 48000;

struct DecodeResult {
    bool success;
    std::string error_message;
    int duration_ms;
    std::vector<float> waveform;
};

// File-based audio decoder.
// Takes any audio file path and decodes it to PCM.
// Produces a mono Ogg Opus at output_path, reusing the source verbatim when it
// is already mono Ogg Opus at a legal rate (no transcode).
// Extracts 60-point waveform.
// Uses libopusfile for .opus/.ogg files, miniaudio for everything else.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult transcode_audio_to_opus(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes,
    int frame_ms = 20);

// Memory-based audio decoder.
// Reads audio from in-memory buffer — no temp file needed.
// Same decode → Ogg Opus → waveform pipeline (with source reuse fast-path).
// `data` must remain valid for duration of call.
// `max_audio_bytes` caps the buffer size (comes from @ekwe/shared/plans).
DecodeResult transcode_audio_to_opus_from_memory(
    const uint8_t* data,
    size_t data_size,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes,
    int frame_ms = 20);

// Decodes any audio file into a standalone PCM WAV file (no re-encode).
// Ogg Opus is decoded via libopusfile and everything else via miniaudio, both
// normalised to the mono contract above. Used by the iOS app to make
// recorded Opus playable through AVPlayer/expo-audio, which has no native
// Ogg Opus support.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult decode_audio_to_wav(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Remuxes any audio file into an Opus-in-CAF file (no WAV re-encode).
// Ogg Opus sources are remuxed packet-for-packet into the CAF container
// (lossless container change — no decode/re-encode), everything else is
// decoded via miniaudio then re-encoded to Opus. CAF is Apple's native
// compressed container; Opus-in-CAF is supported by iOS AVPlayer/AVAudioPlayer
// (iOS 11+) where the Ogg container is not.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult remux_audio_to_caf(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Decodes any audio file and reports only its duration and waveform, without
// writing an output artifact. Used to derive a recording's waveform from the
// finished Ogg at stop, through the exact same decode + waveform code the
// shared/imported path uses, so the two cannot drift apart.
// `max_audio_bytes` caps the input file size (comes from @ekwe/shared/plans).
DecodeResult analyze_audio_file(
    const std::string& input_path,
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
    const std::string& output_path,
    int frame_ms = 20);

} // namespace ekwe
