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
constexpr size_t kDefaultMaxAudioBytes = 10 * 1024 * 1024; // 10,485,760

// Hard ceiling on decoded audio *duration*, independent of sample rate.
// Expressed in time rather than sample count so a 48 kHz source cannot consume
// memory 3x faster than a 16 kHz one while hitting the same nominal limit.
// Guards against decompression bombs and very long sources that a small
// compressed file can expand into (e.g. hours of low-bitrate Opus).
constexpr int kMaxAudioDurationMs = 30 * 60 * 1000; // 30 min

// RFC 7845: Ogg Opus granule positions are always measured in 48 kHz samples,
// independent of the encoder's input sample rate (which may be 16 kHz).
constexpr int32_t kOpusGranuleRate = 48000;

// The decode contract for every path in this module: mono PCM at
// kRecorderSampleRate (16 kHz).
//
// Every path here normalises to mono. Sources that are multi-channel (provider
// TTS commonly ships stereo) are downmixed rather than trusted, because
// trusting a per-source channel count is what previously made duration,
// waveform, and re-encode disagree with each other.
//
// 16 kHz is what the recorder already produces, so a recording and a
// synthesized clip of the same voice are directly comparable.
//
// Ogg Opus sources are decoded at 48 kHz regardless of what they declare. The
// vendored libopusfile creates its decoder with a hardcoded 48000
// (opus_multistream_decoder_create(48000, …) in
// thirdparty/opusfile/src/opusfile.c) and predates
// op_set_decoding_sample_rate(), so op_read() and op_pcm_total() both count
// 48 kHz samples no matter what the stream declares. Tagging those samples with
// the declared rate is exactly the kind of silent lie this contract exists to
// prevent — it made a 1.5 s recording report 4.5 s and re-encoded such a file
// stretched 3x with the pitch dragged down an octave and change. So the samples
// are resampled down to kRecorderSampleRate after they are read.
//
// miniaudio sources (WAV/MP3/M4A/…) get there on their own: miniaudio resamples
// to the requested rate as part of decoding.
constexpr uint16_t kTargetChannels = 1;
constexpr uint32_t kRecorderSampleRate = 16000;
constexpr uint32_t kOpusDecodeSampleRate = 48000;

// Members are initialised so a default-constructed result is already a failed
// one: the early returns below set error_message and hand the struct back
// without touching success or duration_ms, and callers read both.
struct DecodeResult {
    bool success = false;
    std::string error_message;
    int duration_ms = 0;
    std::vector<float> waveform;
};

// Decodes any audio file to a mono Ogg Opus at output_path, reusing the
// source verbatim when it is already mono Ogg Opus at a legal rate.
// Extracts a 60-point waveform. `max_audio_bytes` caps the input file size.
//
// Ogg sniffing separates Opus (libopusfile) from Vorbis (stb_vorbis inside
// miniaudio); everything else (WAV/MP3/FLAC/AIFF) also goes through miniaudio.
DecodeResult transcode_audio_to_opus(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes,
    int frame_ms = 20);

// Same decode → Ogg Vorbis → waveform pipeline, for the Wit.ai upload path,
// which decodes Vorbis but not Opus (see apps/worker/src/providers/witai.ts).
// Unlike the Opus path there is no source-reuse fast path: whatever the input
// is, the bytes on disk have to be Vorbis, so it is always re-encoded.
// `max_audio_bytes` caps the input file size.
DecodeResult transcode_audio_to_vorbis(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Decodes once and writes both Ogg Opus and Ogg Vorbis. The Opus artifact is
// the one kept for playback; the Vorbis one is the upload copy Wit.ai can
// parse. Sharing a single decode matters because the two codecs otherwise
// each pay for their own.
struct DualTranscodeResult {
    DecodeResult opus;
    DecodeResult vorbis;
};

DualTranscodeResult transcode_audio_to_dual(
    const std::string& input_path,
    const std::string& opus_output_path,
    const std::string& vorbis_output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Collapses interleaved PCM to the mono/16 kHz decode contract: averages down
// to kTargetChannels, enforces kMaxAudioDurationMs, and resamples to
// kRecorderSampleRate. Shared by the Opus and Vorbis re-encode entry points so
// a platform decoder's output cannot be normalised two different ways.
// Returns false with `error` set ("AUDIO_TOO_LONG" when the ceiling trips).
bool normalize_pcm_to_contract(const int16_t* pcm_data,
                               size_t sample_count,
                               uint16_t channels,
                               uint32_t sample_rate,
                               std::vector<int16_t>& mono_samples,
                               std::string& error);

// Memory-based audio decoder.
// Reads audio from in-memory buffer — no temp file needed.
// Same decode → Ogg Opus → waveform pipeline (with source reuse fast-path).
// `data` must remain valid for duration of call.
// `max_audio_bytes` caps the buffer size.
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
// `max_audio_bytes` caps the input file size.
DecodeResult decode_audio_to_wav(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Remuxes any audio file into an Opus-in-CAF file. Ogg Opus sources are
// remuxed packet-for-packet (lossless container change); everything else is
// decoded via miniaudio then re-encoded to Opus. Opus-in-CAF is supported by
// iOS AVPlayer/AVAudioPlayer (iOS 11+) where the Ogg container is not.
// Deliberately does not normalise the sample rate — it is a container change
// for playback, so the packets pass through untouched.
// `max_audio_bytes` caps the input file size.
DecodeResult remux_audio_to_caf(
    const std::string& input_path,
    const std::string& output_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Decodes any audio file and reports only its duration and waveform, without
// writing an output artifact. Used to derive a recording's waveform from the
// finished Ogg at stop, through the exact same decode + waveform code the
// shared/imported path uses, so the two cannot drift apart.
// `max_audio_bytes` caps the input file size.
DecodeResult analyze_audio_file(
    const std::string& input_path,
    size_t max_audio_bytes = kDefaultMaxAudioBytes);

// Takes raw PCM int16 data (already decoded by platform),
// downmixes to the mono/16 kHz decode contract, encodes to Ogg Opus,
// computes 60-point waveform.
// Used when a platform's hardware decoder handles formats
// that miniaudio cannot (e.g. AAC/M4A or AMR on Android).
DecodeResult encode_pcm_to_opus(
    const int16_t* pcm_data,
    size_t num_samples,
    uint32_t sample_rate,
    uint16_t channels,
    const std::string& output_path,
    int frame_ms = 20);

// Duration of an audio file without decoding it; -1 when unknown.
int probe_audio_duration_ms(const std::string& input_path);

} // namespace ekwe
