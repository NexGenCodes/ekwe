#include "EkweAudioDecoder.h"
#include "EkweOpusEncoder.h"
#include "EkweVorbisEncoder.h"
#include "EkweOggMuxer.h"
#include "EkweCafMuxer.h"
#include "EkweWaveform.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>
#include <cstdio>

#define STB_VORBIS_IMPLEMENTATION
#include "thirdparty/stb_vorbis.c"

#define MINIAUDIO_IMPLEMENTATION
#include "thirdparty/miniaudio.h"

#include "thirdparty/opusfile/include/opusfile.h"
#include <ogg/ogg.h>

namespace ekwe {

// Ogg is a container shared by Opus, Vorbis and other codecs — the bare
// "OggS" magic is not enough to pick a decoder.
enum OggStreamKind {
    kNotOgg,
    kOggOpus,
    kOggNonOpus,
};

static OggStreamKind classify_ogg(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return kNotOgg;
    char header[4];
    if (!file.read(header, 4) || strncmp(header, "OggS", 4) != 0) {
        return kNotOgg;
    }
    // The codec identification packet lives within the first few hundred
    // bytes of the file for every sane encoder; a 4 KiB sniff is plenty.
    char buf[4100] = {};
    std::streamsize n = file.readsome(buf, sizeof(buf) - 1);
    if (n <= 0) return kOggNonOpus;
    static constexpr const char kOpusMagic[] = "OpusHead";
    const size_t k = sizeof(kOpusMagic) - 1;
    for (std::streamsize i = 0; i + static_cast<std::streamsize>(k) <= n; ++i) {
        if (std::memcmp(buf + i, kOpusMagic, k) == 0) {
            return kOggOpus;
        }
    }
    return kOggNonOpus;
}

static bool is_ogg_opus(const std::string& path) {
    return classify_ogg(path) == kOggOpus;
}

static bool file_size(const std::string& path, uint64_t& out_size) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return false;
    std::streampos end = file.tellg();
    if (end < 0) return false;
    out_size = static_cast<uint64_t>(end);
    return true;
}

// Everything a decode path establishes about the PCM it produced. Bundled so a
// sample rate can never be attached to a buffer it did not come from, which is
// how duration and re-encode previously drifted apart.
struct MonoPcm {
    std::vector<int16_t> samples;
    uint32_t sample_rate = 0;
    // True when the source bytes are already mono Opus at a legal rate, so the
    // caller can copy the original file instead of re-encoding.
    bool source_is_reusable = false;
};

// Maximum mono samples a buffer of `sample_rate` may hold before it trips the
// duration ceiling. Rate-aware so the limit means 30 minutes everywhere.
static size_t max_mono_samples_for_rate(uint32_t sample_rate) {
    if (sample_rate == 0) return 0;
    return static_cast<size_t>(kMaxAudioDurationMs) * sample_rate / 1000ULL;
}

static int pcm_duration_ms(size_t mono_sample_count, uint32_t sample_rate) {
    if (sample_rate == 0) return 0;
    return static_cast<int>(mono_sample_count * 1000ULL / sample_rate);
}

// Appends PCM that is already mono. Refuses to exceed the duration ceiling so
// a pathological source cannot exhaust memory. Returns false when it trips.
static bool append_mono_pcm(MonoPcm& pcm, const int16_t* data, size_t count) {
    if (count == 0) return true;
    const size_t limit = max_mono_samples_for_rate(pcm.sample_rate);
    if (pcm.samples.size() + count > limit) return false;
    pcm.samples.insert(pcm.samples.end(), data, data + count);
    return true;
}

// Appends interleaved PCM as mono, averaging channels. Opus sources are decoded
// straight from the bitstream and therefore carry whatever channel count
// OpusHead declares, so unlike the miniaudio paths they are not mono by
// construction. Returns false when the duration ceiling is hit.
static bool append_mono_pcm(MonoPcm& pcm, const int16_t* data, size_t sample_count,
                            uint16_t source_channels) {
    if (source_channels <= kTargetChannels) {
        return append_mono_pcm(pcm, data, sample_count);
    }

    const size_t frames = sample_count / source_channels;
    if (frames == 0) return true;
    const size_t limit = max_mono_samples_for_rate(pcm.sample_rate);
    if (pcm.samples.size() + frames > limit) return false;
    pcm.samples.reserve(pcm.samples.size() + frames);
    for (size_t f = 0; f < frames; ++f) {
        int32_t sum = 0;
        for (uint16_t c = 0; c < source_channels; ++c) {
            sum += data[f * source_channels + c];
        }
        pcm.samples.push_back(static_cast<int16_t>(sum / static_cast<int32_t>(source_channels)));
    }
    return true;
}

// op_read() emits at most one 60 ms Opus frame per call — the longest frame
// Opus defines — so at the 48 kHz maximum rate that is 2880 samples per
// channel. This buffer is comfortably larger than that ceiling.
constexpr int kOpusReadChunkSamples = 9600;

// Opus is only ever defined at these input rates. Anything else in an OpusHead
// is malformed, and we must not feed it to the encoder or divide by it.
static bool is_legal_opus_rate(uint32_t rate) {
    return rate == 8000 || rate == 12000 || rate == 16000 ||
           rate == 24000 || rate == 48000;
}

class LinearResampler {
public:
    LinearResampler(uint32_t from_rate, uint32_t to_rate) {
        const ma_linear_resampler_config config =
            ma_linear_resampler_config_init(ma_format_s16, 1, from_rate, to_rate);
        ok_ = ma_linear_resampler_init(&config, nullptr, &resampler_) == MA_SUCCESS;
    }
    ~LinearResampler() {
        if (ok_) ma_linear_resampler_uninit(&resampler_, nullptr);
    }

    LinearResampler(const LinearResampler&) = delete;
    LinearResampler& operator=(const LinearResampler&) = delete;

    bool ok() const { return ok_; }
    ma_linear_resampler* get() { return &resampler_; }

private:
    ma_linear_resampler resampler_;
    bool ok_ = false;
};

// The resampler stops once it runs out of input, so an undersized buffer would
// silently truncate the clip. A couple of spare frames rules that out.
constexpr ma_uint64 kResampleSlackFrames = 2;

// Resamples mono int16 PCM, replacing it with the converted result. miniaudio
// low-pass filters to the lower rate's Nyquist, so downsampling does not alias.
// Fails rather than leaving `samples` at the wrong rate.
static bool resample_mono(std::vector<int16_t>& samples,
                          uint32_t from_rate, uint32_t to_rate) {
    if (from_rate == 0 || to_rate == 0 || from_rate == to_rate) return true;
    if (samples.empty()) return true;

    LinearResampler resampler(from_rate, to_rate);
    if (!resampler.ok()) return false;

    ma_uint64 expected = 0;
    if (ma_linear_resampler_get_expected_output_frame_count(
            resampler.get(), samples.size(), &expected) != MA_SUCCESS) {
        return false;
    }

    std::vector<int16_t> resampled(expected + kResampleSlackFrames);

    ma_uint64 in_frames = samples.size();
    ma_uint64 out_frames = resampled.size();
    if (ma_linear_resampler_process_pcm_frames(resampler.get(), samples.data(),
                                               &in_frames, resampled.data(),
                                               &out_frames) != MA_SUCCESS) {
        return false;
    }

    resampled.resize(out_frames);
    samples.swap(resampled);
    return true;
}

bool normalize_pcm_to_contract(const int16_t* pcm_data, size_t sample_count,
                               uint16_t channels, uint32_t sample_rate,
                               std::vector<int16_t>& mono_samples,
                               std::string& error) {
    if (pcm_data == nullptr || sample_count == 0) {
        error = "PCM data is null or empty.";
        return false;
    }
    if (channels == 0 || sample_rate == 0) {
        error = "channels and sample_rate must be positive.";
        return false;
    }

    MonoPcm mono_pcm;
    mono_pcm.sample_rate = sample_rate;
    if (!append_mono_pcm(mono_pcm, pcm_data, sample_count, channels)) {
        error = "AUDIO_TOO_LONG";
        return false;
    }
    if (pcm_duration_ms(mono_pcm.samples.size(), mono_pcm.sample_rate) >
        kMaxAudioDurationMs) {
        error = "AUDIO_TOO_LONG";
        return false;
    }
    if (!resample_mono(mono_pcm.samples, mono_pcm.sample_rate, kRecorderSampleRate)) {
        error = "Failed to resample PCM to recorder rate.";
        return false;
    }

    mono_samples = std::move(mono_pcm.samples);
    return true;
}

// Decodes an already-open Ogg Opus stream to mono PCM, downmixing multi-channel
// sources.
//
// The rate op_read() counts samples in is kOpusDecodeSampleRate (48 kHz), NOT
// the stream's declared OpusHead.input_sample_rate. This vendored libopusfile
// always decodes at 48 kHz — it hardcodes 48000 when creating the decoder and
// has no op_set_decoding_sample_rate() — so tagging its output with the declared
// rate inflated every duration by the 48000/rate ratio and re-encoded such a file
// at a third of its real speed, dragging the pitch down with it.
//
// The buffer is nonetheless resampled down to kRecorderSampleRate before it is
// handed back, so every decode path yields the same 16 kHz mono contract. See
// resample_mono() for why 16 kHz is required rather than preferred.
static bool decode_opus_to_mono_pcm(OggOpusFile* of, MonoPcm& pcm,
                                     std::string& error) {
    const OpusHead* head = op_head(of, -1);
    if (head == nullptr) {
        error = "Opus stream is missing its OpusHead identification header.";
        return false;
    }

    // Not fatal on its own: the decode rate is 48 kHz regardless. A stream
    // declaring something outside the Opus set is malformed though, and it is
    // the one signal that the file is not what it claims to be.
    if (!is_legal_opus_rate(head->input_sample_rate)) {
        error = "Opus stream declares an unsupported sample rate: " +
                std::to_string(head->input_sample_rate);
        return false;
    }

    const uint16_t source_channels =
        head->channel_count > 0 ? head->channel_count : kTargetChannels;

    // The source bytes are only worth keeping when re-encoding them would
    // reproduce the same file. Mono alone is not enough: a stream declaring a
    // rate other than kRecorderSampleRate has to be resampled and re-encoded.
    const bool rate_matches = (head->input_sample_rate == kRecorderSampleRate);

    pcm.sample_rate = kOpusDecodeSampleRate;
    pcm.source_is_reusable = (source_channels == kTargetChannels) && rate_matches;

    std::vector<int16_t> buffer(static_cast<size_t>(kOpusReadChunkSamples) * source_channels);
    for (;;) {
        const int samples_read =
            op_read(of, reinterpret_cast<opus_int16*>(buffer.data()),
                    static_cast<int>(buffer.size()), nullptr);
        if (samples_read <= 0) break;
        // op_read() reports samples PER CHANNEL, while append_mono_pcm() takes
        // the interleaved total and divides it by the channel count to get
        // frames. Handing it the per-channel count made every multi-channel
        // source come back with half its samples — a stereo file decoded to a
        // mono track running at half speed and an octave low.
        if (!append_mono_pcm(pcm, buffer.data(),
                             static_cast<size_t>(samples_read) * source_channels,
                             source_channels)) {
            error = "AUDIO_TOO_LONG";
            return false;
        }
    }

    if (!rate_matches) {
        if (!resample_mono(pcm.samples, kOpusDecodeSampleRate, kRecorderSampleRate)) {
            error = "Failed to resample Opus stream to " +
                    std::to_string(kRecorderSampleRate) + " Hz.";
            return false;
        }
        pcm.sample_rate = kRecorderSampleRate;
    }

    return true;
}

static bool copy_file(const std::string& src, const std::string& dst) {
    std::ifstream in(src, std::ios::binary);
    if (!in) return false;
    std::ofstream out(dst, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out << in.rdbuf();
    out.flush();
    return out.good();
}

static bool write_bytes(const uint8_t* data, size_t size, const std::string& dst) {
    std::ofstream out(dst, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out.write(reinterpret_cast<const char*>(data), static_cast<std::streamsize>(size));
    out.flush();
    return out.good();
}

// Writes little-endian 44-byte-header PCM WAV (16-bit). Self-contained, so the
// playable WAV is independent of any encode/decode state.
static bool write_wav(const std::vector<int16_t>& pcm, uint32_t sample_rate,
                      uint16_t channels, const std::string& output_path) {
    const uint16_t bits_per_sample = 16;
    const uint64_t data_size = static_cast<uint64_t>(pcm.size()) * sizeof(int16_t);
    if (data_size > 0xFFFFFFFFULL) return false; // WAV RIFF chunk is 32-bit
    const uint32_t data_size32 = static_cast<uint32_t>(data_size);
    const uint32_t byte_rate = sample_rate * channels * (bits_per_sample / 8);
    const uint16_t block_align = static_cast<uint16_t>(channels * (bits_per_sample / 8));
    const uint32_t riff_size = 36 + data_size32;

    std::vector<uint8_t> wav(44 + data_size32);
    auto put32 = [&wav](size_t offset, uint32_t v) {
        wav[offset + 0] = static_cast<uint8_t>(v & 0xFF);
        wav[offset + 1] = static_cast<uint8_t>((v >> 8) & 0xFF);
        wav[offset + 2] = static_cast<uint8_t>((v >> 16) & 0xFF);
        wav[offset + 3] = static_cast<uint8_t>((v >> 24) & 0xFF);
    };
    auto put16 = [&wav](size_t offset, uint16_t v) {
        wav[offset + 0] = static_cast<uint8_t>(v & 0xFF);
        wav[offset + 1] = static_cast<uint8_t>((v >> 8) & 0xFF);
    };

    const char riff[4] = {'R', 'I', 'F', 'F'};
    const char wave[4] = {'W', 'A', 'V', 'E'};
    const char fmt_tag[4] = {'f', 'm', 't', ' '};
    const char data_tag[4] = {'d', 'a', 't', 'a'};

    std::memcpy(wav.data(), riff, 4);
    put32(4, riff_size);
    std::memcpy(wav.data() + 8, wave, 4);
    std::memcpy(wav.data() + 12, fmt_tag, 4);
    put32(16, 16);         // fmt chunk size
    put16(20, 1);          // PCM
    put16(22, channels);
    put32(24, sample_rate);
    put32(28, byte_rate);
    put16(32, block_align);
    put16(34, bits_per_sample);
    std::memcpy(wav.data() + 36, data_tag, 4);
    put32(40, data_size32);
    std::memcpy(wav.data() + 44, pcm.data(), pcm.size() * sizeof(int16_t));

    return write_bytes(wav.data(), wav.size(), output_path);
}

static bool encode_opus(const std::vector<int16_t>& pcm_data, uint32_t sample_rate,
                        uint16_t channels, const std::string& output_path, int frame_ms) {
    OpusStreamEncoder encoder(sample_rate, channels);
    if (!encoder.is_ok()) return false;

    OggMuxer muxer(output_path, sample_rate, 1);
    if (!muxer.is_ok()) return false;

    // OpusHead pre-skip is expressed in 48 kHz samples (RFC 7845), but the
    // encoder reports lookahead at its own sample rate. Scale it so the header
    // and the granule positions agree with libopusfile's duration math
    // (duration = final granule - pre_skip).
    const int pre_skip_48k = static_cast<int>(
        static_cast<uint64_t>(encoder.lookahead()) * kOpusGranuleRate / sample_rate);
    if (!muxer.write_opus_header(channels, pre_skip_48k, sample_rate)) return false;
    if (!muxer.write_opus_comment()) return false;

    size_t frame_size = static_cast<size_t>(sample_rate * frame_ms / 1000);
    size_t total_samples = pcm_data.size();
    // RFC 7845 requires Ogg granule positions to always be expressed in units
    // of 48 kHz samples, regardless of the Opus encoder's input sample rate.
    // The granule counts ALL decoded samples INCLUDING pre-skip (libopusfile
    // derives duration as granule - pre_skip), so the counter starts at
    // pre_skip_48k instead of 0. Without this, the player-reported duration
    // under-reports by the lookahead.
    int64_t granule_position = pre_skip_48k;

    std::vector<int16_t> padded_frame;
    for (size_t offset = 0; offset < total_samples; offset += frame_size * channels) {
        size_t remaining_frames = (total_samples - offset) / channels;
        size_t this_frame = std::min(frame_size, remaining_frames);

        // Opus only accepts its canonical frame sizes (2.5/5/10/20/40/60 ms).
        // A final partial frame shorter than frame_size would make opus_encode
        // reject the packet and fail the whole transcode, so pad it with
        // silence to a full frame.
        const int16_t* frame_data = pcm_data.data() + offset;
        if (this_frame < frame_size) {
            padded_frame.assign(frame_data, frame_data + this_frame * channels);
            padded_frame.resize(frame_size * channels, 0);
            frame_data = padded_frame.data();
            this_frame = frame_size;
        }

        std::vector<uint8_t> packet;
        if (!encoder.encode_frame(frame_data, this_frame * channels, packet)) {
            return false;
        }

        granule_position += static_cast<int64_t>(this_frame) * kOpusGranuleRate / static_cast<int64_t>(sample_rate);
        if (!muxer.write_packet(packet.data(), packet.size(), granule_position)) {
            return false;
        }
    }

    muxer.finalize();
    return true;
}

// Decodes any supported audio file to the mono PCM contract above, without
// writing anything. This is the single decode step behind every file-based
// entry point (transcode to Ogg, decode to WAV, remux to CAF, waveform
// analysis), so duration and waveform can never be derived from a different
// decode than the one the caller used.
static bool decode_file_to_mono_pcm(const std::string& input_path,
                                    MonoPcm& pcm, std::string& error) {
    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            error = "Failed to open Opus file. Error code: " + std::to_string(err);
            return false;
        }

        const bool decoded = decode_opus_to_mono_pcm(of, pcm, error);
        op_free(of);
        return decoded;
    }

    // miniaudio resamples and downmixes to the requested format as part of
    // decoding, so this path lands on mono at the recorder rate.
    pcm.sample_rate = kRecorderSampleRate;

    ma_decoder decoder;
    ma_decoder_config config = ma_decoder_config_init(
        ma_format_s16, kTargetChannels, kRecorderSampleRate);

    ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
    if (ma_res != MA_SUCCESS) {
        // Distinct tag so Android can route AAC/AMR/3GP/WebM to the platform
        // decoder instead of reporting a generic decode failure.
        error = "MINIAUDIO_INIT_FAILED";
        return false;
    }

    ma_uint64 total_frames = 0;
    ma_decoder_get_length_in_pcm_frames(&decoder, &total_frames);
    const size_t limit = max_mono_samples_for_rate(pcm.sample_rate);
    if (total_frames > 0) {
        pcm.samples.reserve(static_cast<size_t>(
            std::min<ma_uint64>(total_frames, limit)));
    }

    const int CHUNK_SIZE = 4096;
    std::vector<int16_t> buffer(CHUNK_SIZE);

    ma_uint64 frames_read = 0;
    while (true) {
        ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
        if (frames_read > 0) {
            if (!append_mono_pcm(pcm, buffer.data(), static_cast<size_t>(frames_read))) {
                ma_decoder_uninit(&decoder);
                error = "AUDIO_TOO_LONG";
                return false;
            }
        }
        if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
    }

    ma_decoder_uninit(&decoder);
    return true;
}

// Enforces the shared input-size cap for every file-based entry point.
static bool check_input_size(const std::string& input_path, size_t max_audio_bytes,
                             std::string& error) {
    // A non-positive limit (e.g. a caller bug) would otherwise reject everything
    // below the true cap, so fall back to the shared default in that case.
    if (max_audio_bytes == 0) {
        max_audio_bytes = kDefaultMaxAudioBytes;
    }

    uint64_t input_size = 0;
    if (!file_size(input_path, input_size)) {
        error = "Cannot stat input file.";
        return false;
    }
    if (input_size > max_audio_bytes) {
        error = "FILE_TOO_LARGE";
        return false;
    }
    return true;
}

DecodeResult transcode_audio_to_opus(const std::string& input_path, const std::string& output_path,
                                     size_t max_audio_bytes, int frame_ms) {
    DecodeResult result;
    result.success = false;

    // Reject oversized inputs before any decoding work. This is the only place
    // the file-based path is guarded, on both Android and iOS.
    if (!check_input_size(input_path, max_audio_bytes, result.error_message)) {
        return result;
    }

    MonoPcm pcm;
    if (!decode_file_to_mono_pcm(input_path, pcm, result.error_message)) {
        return result;
    }

    if (pcm.samples.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    if (pcm.source_is_reusable) {
        // No transcode: the input is already mono Ogg Opus, so the source bytes
        // are exactly what we would have written. Copy them as-is while still
        // deriving duration + waveform from the decoded PCM.
        if (!copy_file(input_path, output_path)) {
            result.error_message = "Failed to reuse existing Ogg Opus source.";
            return result;
        }
    } else {
        if (!encode_opus(pcm.samples, pcm.sample_rate, kTargetChannels, output_path, frame_ms)) {
            result.error_message = "Failed to encode Ogg Opus output.";
            return result;
        }
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);

    result.success = true;
    return result;
}

DecodeResult transcode_audio_to_vorbis(const std::string& input_path,
                                       const std::string& output_path,
                                       size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;

    // Same size guard as transcode_audio_to_opus: nothing oversized is
    // ever decoded, on either platform.
    if (!check_input_size(input_path, max_audio_bytes, result.error_message)) {
        return result;
    }

    MonoPcm pcm;
    if (!decode_file_to_mono_pcm(input_path, pcm, result.error_message)) {
        return result;
    }

    if (pcm.samples.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    // No source-reuse branch: unlike the Opus path the bytes on disk have to
    // be Vorbis whatever the input was, so an Ogg Opus recording is always
    // decoded and re-encoded here.
    if (!encode_vorbis(pcm.samples, pcm.sample_rate, kTargetChannels, output_path)) {
        result.error_message = "Failed to encode Vorbis output.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);

    result.success = true;
    return result;
}

DualTranscodeResult transcode_audio_to_dual(const std::string& input_path,
                                            const std::string& opus_output_path,
                                            const std::string& vorbis_output_path,
                                            size_t max_audio_bytes) {
    DualTranscodeResult result;

    if (!check_input_size(input_path, max_audio_bytes, result.opus.error_message)) {
        result.vorbis.error_message = result.opus.error_message;
        return result;
    }

    MonoPcm pcm;
    if (!decode_file_to_mono_pcm(input_path, pcm, result.opus.error_message)) {
        result.vorbis.error_message = result.opus.error_message;
        return result;
    }

    if (pcm.samples.empty()) {
        result.opus.error_message = "Decoded audio is empty.";
        result.vorbis.error_message = result.opus.error_message;
        return result;
    }

    if (pcm.source_is_reusable) {
        if (!copy_file(input_path, opus_output_path)) {
            result.opus.error_message = "Failed to reuse existing Ogg Opus source.";
        }
    } else if (!encode_opus(pcm.samples, pcm.sample_rate, kTargetChannels,
                            opus_output_path, 20)) {
        result.opus.error_message = "Failed to encode Ogg Opus output.";
    }

    if (!encode_vorbis(pcm.samples, pcm.sample_rate, kTargetChannels,
                       vorbis_output_path)) {
        result.vorbis.error_message = "Failed to encode Vorbis output.";
    }

    const int duration_ms =
        static_cast<int>(pcm_duration_ms(pcm.samples.size(), pcm.sample_rate));
    const std::vector<float> waveform = compute_waveform(pcm.samples);

    if (result.opus.error_message.empty()) {
        result.opus.duration_ms = duration_ms;
        result.opus.waveform = waveform;
        result.opus.success = true;
    }
    if (result.vorbis.error_message.empty()) {
        result.vorbis.duration_ms = duration_ms;
        result.vorbis.waveform = waveform;
        result.vorbis.success = true;
    }

    return result;
}

DecodeResult analyze_audio_file(const std::string& input_path, size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;

    if (!check_input_size(input_path, max_audio_bytes, result.error_message)) {
        return result;
    }

    MonoPcm pcm;
    if (!decode_file_to_mono_pcm(input_path, pcm, result.error_message)) {
        return result;
    }

    if (pcm.samples.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);

    result.success = true;
    return result;
}

// ─── Decode → WAV (for players without Ogg Opus support, e.g. AVPlayer) ───

DecodeResult decode_audio_to_wav(const std::string& input_path, const std::string& output_path,
                                 size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;

    // Same size guard as transcode_audio_to_opus: never decode anything
    // the plan cap doesn't allow.
    if (max_audio_bytes == 0) {
        max_audio_bytes = kDefaultMaxAudioBytes;
    }

    uint64_t input_size = 0;
    if (!file_size(input_path, input_size)) {
        result.error_message = "Cannot stat input file.";
        return result;
    }
    if (input_size > max_audio_bytes) {
        result.error_message = "FILE_TOO_LARGE";
        return result;
    }

    MonoPcm pcm;

    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        std::string opus_error;
        const bool decoded = decode_opus_to_mono_pcm(of, pcm, opus_error);
        op_free(of);
        if (!decoded) {
            result.error_message = opus_error;
            return result;
        }
    } else {
        // miniaudio resamples and downmixes to the requested format as part of
        // decoding, so this path lands on mono at the recorder rate.
        pcm.sample_rate = kRecorderSampleRate;

        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(
            ma_format_s16, kTargetChannels, kRecorderSampleRate);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "MINIAUDIO_INIT_FAILED";
            return result;
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE);

        ma_uint64 frames_read = 0;
        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_mono_pcm(pcm, buffer.data(), static_cast<size_t>(frames_read))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm.samples.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    if (!write_wav(pcm.samples, pcm.sample_rate, kTargetChannels, output_path)) {
        result.error_message = "Failed to write WAV output.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);

    result.success = true;
    return result;
}

// ─── One Opus packet plus where it lives in the concatenated data chunk. ───
struct CafPacket {
    size_t offset;
    size_t size;
    uint64_t frames; // decoded frames at 48 kHz (RFC 7845 units)
};

// Demuxes the first Opus logical stream from an Ogg file, capturing the
// OpusHead magic cookie (verbatim → kuki chunk), the per-packet byte/frame
// table, and the concatenated packet bytes. Single-chain files only.
static bool read_ogg_opus_packets(const std::string& path,
                                  std::vector<uint8_t>& opus_head,
                                  std::vector<uint8_t>& audio_bytes,
                                  std::vector<CafPacket>& packets,
                                  uint64_t& total_frames,
                                  uint16_t& channels,
                                  uint64_t& pre_skip,
                                  std::string& error) {
    FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        error = "Cannot open input file.";
        return false;
    }

    ogg_sync_state sync;
    ogg_stream_state stream;
    ogg_page page;
    ogg_packet packet;
    ogg_sync_init(&sync);

    bool have_stream = false;
    bool stream_is_opus = false;
    bool found_opus = false;
    uint64_t stream_granule = 0; // authoritative 48 kHz sample count (RFC 7845)

    const size_t BUFFER_SIZE = 4096;
    char buffer[BUFFER_SIZE];
    size_t bytes_read = 0;
    while ((bytes_read = std::fread(buffer, 1, BUFFER_SIZE, file)) > 0) {
        char* sync_buffer = ogg_sync_buffer(&sync, static_cast<long>(bytes_read));
        std::memcpy(sync_buffer, buffer, bytes_read);
        ogg_sync_wrote(&sync, static_cast<long>(bytes_read));

        while (ogg_sync_pageout(&sync, &page) == 1) {
            if (ogg_page_bos(&page)) {
                if (have_stream) {
                    ogg_stream_clear(&stream);
                    have_stream = false;
                }
                ogg_stream_init(&stream, ogg_page_serialno(&page));
                have_stream = true;
                stream_is_opus = false;
            }

            if (!have_stream) continue;
            if (ogg_stream_pagein(&stream, &page) != 0) continue;
            if (stream_is_opus) {
                // Page granules record the sample count after the last packet
                // completed on the page; the final page's granule is the total.
                long long page_granule = ogg_page_granulepos(&page);
                if (page_granule >= 0) {
                    stream_granule = static_cast<uint64_t>(page_granule);
                }
            }

            while (ogg_stream_packetout(&stream, &packet) == 1) {
                if (!stream_is_opus) {
                    // The first packet of a logical stream identifies its codec.
                    if (packet.bytes >= 8 &&
                        std::memcmp(packet.packet, "OpusHead", 8) == 0) {
                        stream_is_opus = true;
                        if (opus_head.empty()) {
                            if (packet.bytes < 19) {
                                error = "Malformed OpusHead packet.";
                                ogg_sync_clear(&sync);
                                if (have_stream) ogg_stream_clear(&stream);
                                std::fclose(file);
                                return false;
                            }
                            opus_head.assign(packet.packet, packet.packet + packet.bytes);
                            channels = static_cast<uint16_t>(opus_head[9]);
                            pre_skip = static_cast<uint64_t>(opus_head[10]) |
                                       (static_cast<uint64_t>(opus_head[11]) << 8);
                        }
                    }
                    continue;
                }

                if (packet.bytes >= 8 &&
                    std::memcmp(packet.packet, "OpusTags", 8) == 0) {
                    continue;
                }
                if (packet.bytes <= 0) continue;

                int nb_frames = opus_packet_get_nb_frames(packet.packet, packet.bytes);
                int spf = opus_packet_get_samples_per_frame(packet.packet, kOpusGranuleRate);
                if (nb_frames < 1 || spf < 1) {
                    error = "Invalid Opus packet in source.";
                    ogg_sync_clear(&sync);
                    if (have_stream) ogg_stream_clear(&stream);
                    std::fclose(file);
                    return false;
                }

                CafPacket entry;
                entry.offset = audio_bytes.size();
                entry.size = static_cast<size_t>(packet.bytes);
                entry.frames = static_cast<uint64_t>(nb_frames) * static_cast<uint64_t>(spf);
                audio_bytes.insert(audio_bytes.end(), packet.packet, packet.packet + packet.bytes);
                packets.push_back(entry);
                total_frames += entry.frames;
                found_opus = true;
            }

            if (ogg_page_eos(&page) && have_stream) {
                ogg_stream_clear(&stream);
                have_stream = false;
                if (found_opus) break; // single-chain source is complete
            }
        }
        if (found_opus && !have_stream) break;
    }

    ogg_sync_clear(&sync);
    if (have_stream) ogg_stream_clear(&stream);
    std::fclose(file);

    if (opus_head.empty()) {
        error = "No Opus stream found in Ogg file.";
        return false;
    }
    if (!found_opus) {
        error = "No audio packets found in Ogg Opus file.";
        return false;
    }

    if (stream_granule > 0) {
        // The TOC-derived per-packet counts can overstate the final packet: the
        // last Opus packet is a flush packet whose TOC claims a full frame but
        // which only carries the tail + pre-skip region. The Ogg page granule
        // is authoritative, so subtract any excess from the last entry to make
        // sum(entries) == final granule. Readers (e.g. FFmpeg's cafdemuxer and
        // AVPlayer) derive duration as sum(entries) - priming.
        uint64_t toc_sum = 0;
        for (const CafPacket& p : packets) toc_sum += p.frames;
        if (toc_sum > stream_granule) {
            uint64_t excess = toc_sum - stream_granule;
            uint64_t& last_frames = packets.back().frames;
            last_frames = last_frames > excess ? last_frames - excess : 0;
        }
        total_frames = stream_granule;
    }

    return true;
}

// Re-encodes decoded PCM into Opus and muxes into CAF (non-Ogg fallback).
static bool encode_pcm_to_caf(const std::vector<int16_t>& pcm_data,
                              uint32_t sample_rate,
                              uint16_t channels,
                              const std::string& output_path,
                              std::string& error) {
    OpusStreamEncoder encoder(sample_rate, channels);
    if (!encoder.is_ok()) {
        error = "Failed to init Opus encoder.";
        return false;
    }

    // Pre-skip is expressed in 48 kHz samples regardless of the encoder's
    // input sample rate (RFC 7845).
    const uint64_t pre_skip =
        static_cast<uint64_t>(encoder.lookahead()) * kOpusGranuleRate / sample_rate;

    CafMuxer muxer(output_path, kOpusGranuleRate, channels);
    if (!muxer.write_opus_header(channels, static_cast<int>(pre_skip), sample_rate)) {
        error = "Failed to init CAF muxer.";
        return false;
    }

    const size_t frame_size = sample_rate / 50; // 20 ms frames
    std::vector<int16_t> padded_frame;
    for (size_t offset = 0; offset < pcm_data.size(); offset += frame_size * channels) {
        size_t remaining_frames = (pcm_data.size() - offset) / channels;
        size_t this_frame = std::min(frame_size, remaining_frames);
        if (this_frame == 0) break;

        // Opus only accepts its canonical frame sizes. A final partial frame
        // shorter than frame_size would make opus_encode reject the packet and
        // fail the whole conversion, so pad it with silence to a full frame.
        const int16_t* frame_data = pcm_data.data() + offset;
        if (this_frame < frame_size) {
            padded_frame.assign(frame_data, frame_data + this_frame * channels);
            padded_frame.resize(frame_size * channels, 0);
            frame_data = padded_frame.data();
            this_frame = frame_size;
        }

        std::vector<uint8_t> packet;
        if (!encoder.encode_frame(frame_data, this_frame * channels, packet)) {
            error = "Opus encoding failed.";
            return false;
        }

        int nb_frames = opus_packet_get_nb_frames(packet.data(), static_cast<opus_int32>(packet.size()));
        int spf = opus_packet_get_samples_per_frame(packet.data(), kOpusGranuleRate);
        if (nb_frames < 1 || spf < 1) {
            error = "Encoder produced an invalid Opus packet.";
            return false;
        }

        const uint64_t frames = static_cast<uint64_t>(nb_frames) * static_cast<uint64_t>(spf);
        if (!muxer.write_packet(packet.data(), packet.size(), frames)) {
            error = "Failed to write CAF packet.";
            return false;
        }
    }

    if (!muxer.finalize()) {
        error = "No audio packets to write.";
        return false;
    }
    return true;
}

DecodeResult remux_audio_to_caf(const std::string& input_path, const std::string& output_path,
                                 size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;
    result.duration_ms = 0;
    result.error_message.clear();

    if (max_audio_bytes == 0) {
        max_audio_bytes = kDefaultMaxAudioBytes;
    }

    uint64_t input_size = 0;
    if (!file_size(input_path, input_size)) {
        result.error_message = "Cannot stat input file.";
        return result;
    }
    if (input_size > max_audio_bytes) {
        result.error_message = "FILE_TOO_LARGE";
        return result;
    }

    if (is_ogg_opus(input_path)) {
        // Remux path: re-containerize the Ogg Opus packets into CAF with no
        // decode/re-encode, preserving the source quality exactly.
        std::vector<uint8_t> opus_head;
        std::vector<uint8_t> audio_bytes;
        std::vector<CafPacket> packets;
        uint64_t total_frames = 0;
        uint16_t channels = 1;
        uint64_t pre_skip = 0;

        if (!read_ogg_opus_packets(input_path, opus_head, audio_bytes, packets,
                                   total_frames, channels, pre_skip, result.error_message)) {
            return result;
        }

        // Re-containerize the exact Opus packets (kuki = OpusHead verbatim,
        // pakt frame counts reconciled against the source granule).
        CafMuxer muxer(output_path, kOpusGranuleRate, channels);
        if (!muxer.set_opus_head(opus_head.data(), opus_head.size(), pre_skip)) {
            result.error_message = "Malformed OpusHead packet.";
            return result;
        }
        for (const CafPacket& p : packets) {
            if (!muxer.write_packet(audio_bytes.data() + p.offset, p.size, p.frames)) {
                result.error_message = "Failed to write CAF packet.";
                return result;
            }
        }
        if (!muxer.finalize()) {
            result.error_message = "No audio packets to write.";
            return result;
        }

        const int64_t audible_ms =
            static_cast<int64_t>(total_frames > pre_skip ? total_frames - pre_skip : 0) *
            1000 / kOpusGranuleRate;
        result.duration_ms = static_cast<int>(std::max<int64_t>(audible_ms, 0));
    } else {
        // Non-Opus source: decode to PCM via miniaudio, then re-encode to Opus
        // and mux into CAF so iOS can still play it.
        MonoPcm pcm;
        pcm.sample_rate = kRecorderSampleRate;

        // miniaudio resamples and downmixes to the requested format as part of
        // decoding, so we do not read the rate back off the decoder: the buffer
        // is mono at exactly the rate we asked for.
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(
            ma_format_s16, kTargetChannels, kRecorderSampleRate);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "MINIAUDIO_INIT_FAILED";
            return result;
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_mono_pcm(pcm, buffer.data(), static_cast<size_t>(frames_read))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);

        if (pcm.samples.empty()) {
            result.error_message = "Decoded audio is empty.";
            return result;
        }

        if (!encode_pcm_to_caf(pcm.samples, pcm.sample_rate, kTargetChannels,
                                output_path, result.error_message)) {
            return result;
        }

        result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    }

    result.success = true;
    return result;
}

// ─── Memory-based decoder (for content:// → Ogg Opus without temp file) ───

struct MemStream {
    const uint8_t* data;
    size_t size;
    size_t pos;
};

static int mem_read(void* stream, unsigned char* ptr, int nbytes) {
    auto* ms = static_cast<MemStream*>(stream);
    int available = static_cast<int>(std::min<size_t>(nbytes, ms->size - ms->pos));
    if (available > 0) {
        std::memcpy(ptr, ms->data + ms->pos, available);
        ms->pos += available;
    }
    return available;
}

static int mem_seek(void* stream, opus_int64 offset, int whence) {
    auto* ms = static_cast<MemStream*>(stream);
    switch (whence) {
        case SEEK_SET:
            ms->pos = std::min<size_t>(static_cast<size_t>(offset), ms->size);
            break;
        case SEEK_CUR: {
            opus_int64 new_pos = static_cast<opus_int64>(ms->pos) + offset;
            ms->pos = std::min<size_t>(std::max<opus_int64>(0, new_pos), ms->size);
            break;
        }
        case SEEK_END:
            ms->pos = ms->size;
            break;
    }
    return 0;
}

static opus_int64 mem_tell(void* stream) {
    return static_cast<opus_int64>(static_cast<MemStream*>(stream)->pos);
}

static int mem_close(void* stream) {
    return 0;
}

DecodeResult transcode_audio_to_opus_from_memory(
    const uint8_t* data, size_t data_size, const std::string& output_path, size_t max_audio_bytes, int frame_ms) {
    DecodeResult result;
    result.success = false;

    if (!data || data_size == 0) {
        result.error_message = "Input data is null or empty.";
        return result;
    }

    // Enforce the size cap here as well so callers that skip the Kotlin/Swift
    // guard (e.g. direct JNI/ObjC usage) cannot hand us an oversized buffer.
    if (max_audio_bytes == 0) {
        max_audio_bytes = kDefaultMaxAudioBytes;
    }
    if (data_size > max_audio_bytes) {
        result.error_message = "FILE_TOO_LARGE";
        return result;
    }

    MonoPcm pcm;

    // An Ogg container holds Opus, Vorbis, or other codecs; sending the
    // whole buffer at libopusfile makes Vorbis look "decoded" and then
    // fail. Classify by the first page's codec id so Vorbis drops to
    // miniaudio below.
    bool has_opus_head = false;
    if (data_size >= 4 &&
        data[0] == 'O' && data[1] == 'g' &&
        data[2] == 'g' && data[3] == 'S') {
        // Same 4 KiB first-page window as classify_ogg().
        const size_t kCapProbe = std::min<size_t>(data_size, 4096);
        static const char kOpusMagic[] = "OpusHead";
        const size_t k = sizeof(kOpusMagic) - 1;
        for (size_t i = 0; i + k <= kCapProbe; ++i) {
            if (std::memcmp(data + i, kOpusMagic, k) == 0) {
                has_opus_head = true;
                break;
            }
        }
    }

    if (data_size >= 4 &&
        data[0] == 'O' && data[1] == 'g' &&
        data[2] == 'g' && data[3] == 'S' && has_opus_head) {
        MemStream ms = { data, data_size, 0 };
        OpusFileCallbacks callbacks = { mem_read, mem_seek, mem_tell, mem_close };

        int err = 0;
        OggOpusFile* of = op_open_callbacks(&ms, &callbacks, nullptr, 0, &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus from memory. Error: " + std::to_string(err);
            return result;
        }

        std::string opus_error;
        const bool decoded = decode_opus_to_mono_pcm(of, pcm, opus_error);
        op_free(of);
        if (!decoded) {
            result.error_message = opus_error;
            return result;
        }
    } else {
        // miniaudio resamples and downmixes to the requested format as part of
        // decoding, so this path lands on mono at the recorder rate.
        pcm.sample_rate = kRecorderSampleRate;

        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(
            ma_format_s16, kTargetChannels, kRecorderSampleRate);

        ma_result ma_res = ma_decoder_init_memory(data, data_size, &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "MINIAUDIO_INIT_FAILED";
            return result;
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_mono_pcm(pcm, buffer.data(), static_cast<size_t>(frames_read))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm.samples.empty()) {
        result.error_message = "Decoded audio from memory is empty.";
        return result;
    }

    if (pcm.source_is_reusable) {
        // No transcode: the source bytes are already mono Ogg Opus.
        if (!write_bytes(data, data_size, output_path)) {
            result.error_message = "Failed to reuse existing Ogg Opus source.";
            return result;
        }
    } else {
        if (!encode_opus(pcm.samples, pcm.sample_rate, kTargetChannels, output_path, frame_ms)) {
            result.error_message = "Failed to encode Ogg Opus from memory-decoded audio.";
            return result;
        }
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);
    result.success = true;
    return result;
}

DecodeResult encode_pcm_to_opus(const int16_t* pcm_data, size_t num_samples,
                                uint32_t sample_rate, uint16_t channels,
                                const std::string& output_path, int frame_ms) {
    DecodeResult result;
    result.success = false;

    // Platform decoders (MediaCodec, AVAssetReader) hand us raw native PCM
    // whose rate/channel count we do not control — collapse it to the mono
    // 16 kHz contract every other decode path produces.
    std::vector<int16_t> mono;
    if (!normalize_pcm_to_contract(pcm_data, num_samples, channels, sample_rate,
                                   mono, result.error_message)) {
        return result;
    }

    if (!encode_opus(mono, kRecorderSampleRate, kTargetChannels,
                     output_path, frame_ms)) {
        result.error_message = "Failed to encode Ogg Opus from PCM data.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(mono.size(), kRecorderSampleRate);
    result.waveform = compute_waveform(mono);

    result.success = true;
    return result;
}

// Duration of an audio file without a full decode; -1 when unknown. Used by
// the share flows to gate against the plan's limit on the *original* file
// before any decode work.
int probe_audio_duration_ms(const std::string& input_path) {
    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) return -1;
        // op_pcm_total counts samples at the 48 kHz decode rate regardless of
        // the stream's declared input rate.
        const ogg_int64_t total48k = op_pcm_total(of, -1);
        op_free(of);
        if (total48k <= 0) return -1;
        return static_cast<int>(total48k * 1000 / kOpusDecodeSampleRate);
    }

    ma_decoder decoder;
    ma_decoder_config config = ma_decoder_config_init(
        ma_format_s16, kTargetChannels, kRecorderSampleRate);
    if (ma_decoder_init_file(input_path.c_str(), &config, &decoder) != MA_SUCCESS) {
        return -1;
    }
    ma_uint64 total_frames = 0;
    ma_decoder_get_length_in_pcm_frames(&decoder, &total_frames);
    ma_decoder_uninit(&decoder);
    if (total_frames == 0) return -1;
    return static_cast<int>(total_frames * 1000 / kRecorderSampleRate);
}

} // namespace ekwe
