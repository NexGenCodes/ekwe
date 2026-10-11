#include "EkweAudioDecoder.h"
#include "EkweOpusEncoder.h"
#include "EkweVorbisEncoder.h"
#include "EkweOggMuxer.h"
#include "EkweWaveform.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>
#include <cstdio>

#include "EkweResampler.h"

#include "thirdparty/opusfile/include/opusfile.h"
#include <vorbis/vorbisfile.h>
#include <ogg/ogg.h>

namespace ekwe {

// Ogg is a container shared by Opus, Vorbis and other codecs — the bare
// "OggS" magic is not enough to pick a decoder.
enum OggStreamKind {
    kNotOgg,
    kOggOpus,
    kOggVorbis,
    kOggOther,
};

OggStreamKind classify_ogg(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return kNotOgg;
    char header[4];
    if (!file.read(header, 4) || strncmp(header, "OggS", 4) != 0) {
        return kNotOgg;
    }
    // The codec identification packet lives within the first few hundred
    // bytes of the file for every sane encoder; a 4 KiB sniff is plenty.
    char buf[4100] = {};
    file.read(buf, sizeof(buf) - 1);
    std::streamsize n = file.gcount();
    if (n <= 0) return kOggOther;
    static constexpr const char kOpusMagic[] = "OpusHead";
    const size_t opus_k = sizeof(kOpusMagic) - 1;
    static constexpr const char kVorbisMagic[] = "\x01vorbis";
    const size_t vorbis_k = sizeof(kVorbisMagic) - 1;
    for (std::streamsize i = 0; i + static_cast<std::streamsize>(opus_k) <= n; ++i) {
        if (std::memcmp(buf + i, kOpusMagic, opus_k) == 0) {
            return kOggOpus;
        }
        if (i + static_cast<std::streamsize>(vorbis_k) <= n &&
            std::memcmp(buf + i, kVorbisMagic, vorbis_k) == 0) {
            return kOggVorbis;
        }
    }
    return kOggOther;
}

static bool is_ogg_opus(const std::string& path) {
    return classify_ogg(path) == kOggOpus;
}

static bool is_ogg_vorbis(const std::string& path) {
    return classify_ogg(path) == kOggVorbis;
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

// Appends interleaved PCM as mono, averaging channels. Opus and Vorbis sources
// are decoded straight from the bitstream and therefore carry whatever channel
// count the stream declares, so unlike the WAV reader they are not mono by
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

// Resamples mono int16 PCM, replacing it with the converted result. r8brain
// applies a proper sinc low-pass, so downsampling does not alias. Fails rather
// than leaving `samples` at the wrong rate.
static bool resample_mono(std::vector<int16_t>& samples,
                          uint32_t from_rate, uint32_t to_rate) {
    if (from_rate == 0 || to_rate == 0 || from_rate == to_rate) return true;
    if (samples.empty()) return true;

    std::vector<int16_t> resampled;
    if (!resample_mono_int16(samples.data(), samples.size(),
                             from_rate, to_rate, resampled)) {
        return false;
    }
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

// Decodes an Ogg Vorbis stream to mono PCM at the recorder rate via
// libvorbisfile. Unlike Opus, Vorbis carries its real sample rate, so the
// output is resampled down to kRecorderSampleRate afterwards.
static bool decode_vorbis_to_mono_pcm(const std::string& input_path,
                                      MonoPcm& pcm, std::string& error) {
    OggVorbis_File vf;
    if (ov_fopen(input_path.c_str(), &vf) != 0) {
        error = "Failed to open Ogg Vorbis file.";
        return false;
    }

    vorbis_info* info = ov_info(&vf, -1);
    if (info == nullptr || info->channels < 1 || info->rate < 1) {
        error = "Ogg Vorbis stream is missing its identification header.";
        ov_clear(&vf);
        return false;
    }
    const uint16_t source_channels = static_cast<uint16_t>(info->channels);
    const uint32_t source_rate = static_cast<uint32_t>(info->rate);
    pcm.sample_rate = source_rate;

    std::vector<int16_t> buffer(4096 * source_channels);
    int bitstream = 0;
    for (;;) {
        // 16-bit signed little-endian output, interleaved by channel.
        const long bytes = ov_read(&vf, reinterpret_cast<char*>(buffer.data()),
                                   static_cast<int>(buffer.size() * sizeof(int16_t)),
                                   0, 2, 1, &bitstream);
        if (bytes == 0) break; // end of stream
        if (bytes < 0) {
            // OV_HOLE marks a recoverable gap; the rest are real failures.
            if (bytes == OV_HOLE) continue;
            error = "Failed to decode Ogg Vorbis file.";
            ov_clear(&vf);
            return false;
        }
        const size_t samples = static_cast<size_t>(bytes) / sizeof(int16_t);
        if (!append_mono_pcm(pcm, buffer.data(), samples, source_channels)) {
            error = "AUDIO_TOO_LONG";
            ov_clear(&vf);
            return false;
        }
    }
    ov_clear(&vf);

    if (!resample_mono(pcm.samples, source_rate, kRecorderSampleRate)) {
        error = "Failed to resample Vorbis stream to " +
                std::to_string(kRecorderSampleRate) + " Hz.";
        return false;
    }
    pcm.sample_rate = kRecorderSampleRate;
    return true;
}

static uint16_t read_le16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

static uint32_t read_le32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

// Parses a RIFF/WAVE buffer into the mono contract. Handles PCM (8/16/24/32-bit)
// and IEEE float (32/64-bit) with any channel count. Sets error="NOT_WAV" when
// the bytes are not RIFF/WAVE so callers can route the source to a platform
// decoder instead of reporting a failure. The only non-Ogg container this module
// decodes itself; everything else (MP3/AAC/M4A/AMR/…) is decoded by the platform.
static bool parse_wav_mono_pcm(const uint8_t* buf, size_t size,
                               MonoPcm& pcm, std::string& error) {
    if (size < 12 || std::memcmp(buf, "RIFF", 4) != 0 ||
        std::memcmp(buf + 8, "WAVE", 4) != 0) {
        error = "NOT_WAV";
        return false;
    }

    uint16_t audio_format = 0;
    uint16_t channels = 0;
    uint16_t bits = 0;
    uint32_t sample_rate = 0;
    const uint8_t* data_ptr = nullptr;
    size_t data_size = 0;
    bool have_fmt = false;

    size_t pos = 12;
    while (pos + 8 <= size) {
        const uint8_t* id = buf + pos;
        uint32_t chunk_size = read_le32(buf + pos + 4);
        const size_t body = pos + 8;
        if (body > size) break;
        // Tolerate a truncated final chunk rather than rejecting the file.
        if (chunk_size > size - body) chunk_size = static_cast<uint32_t>(size - body);

        if (std::memcmp(id, "fmt ", 4) == 0 && chunk_size >= 16) {
            audio_format = read_le16(buf + body + 0);
            channels = read_le16(buf + body + 2);
            sample_rate = read_le32(buf + body + 4);
            bits = read_le16(buf + body + 14);
            if (audio_format == 0xFFFE && chunk_size >= 26) {
                // WAVE_FORMAT_EXTENSIBLE: SubFormat GUID's first two bytes are
                // the real format tag.
                audio_format = read_le16(buf + body + 24);
            }
            have_fmt = true;
        } else if (std::memcmp(id, "data", 4) == 0) {
            data_ptr = buf + body;
            data_size = chunk_size;
        }
        pos = body + chunk_size + (chunk_size & 1u); // chunks are word-aligned
    }

    if (!have_fmt || data_ptr == nullptr || channels == 0 || sample_rate == 0) {
        error = "Malformed WAV file.";
        return false;
    }

    const bool is_pcm = (audio_format == 1);
    const bool is_float = (audio_format == 3);
    if (!is_pcm && !is_float) {
        error = "Unsupported WAV encoding.";
        return false;
    }

    const size_t bytes_per_sample = bits / 8;
    const size_t frame_bytes = bytes_per_sample * channels;
    if (bytes_per_sample == 0 || frame_bytes == 0) {
        error = "Unsupported WAV bit depth.";
        return false;
    }
    const size_t frames = data_size / frame_bytes;
    if (frames == 0) {
        error = "Decoded audio is empty.";
        return false;
    }

    std::vector<int16_t> interleaved(frames * channels);
    for (size_t i = 0; i < interleaved.size(); ++i) {
        const uint8_t* s = data_ptr + i * bytes_per_sample;
        int64_t v = 0;
        if (is_float) {
            if (bits == 32) {
                float f = 0.0f;
                std::memcpy(&f, s, sizeof(f));
                const float clamped = std::max(-1.0f, std::min(1.0f, f));
                v = std::lround(clamped * 32767.0f);
            } else if (bits == 64) {
                double d = 0.0;
                std::memcpy(&d, s, sizeof(d));
                const double clamped = std::max(-1.0, std::min(1.0, d));
                v = std::lround(clamped * 32767.0);
            } else {
                error = "Unsupported float WAV bit depth.";
                return false;
            }
        } else {
            switch (bits) {
                case 8: // WAV 8-bit PCM is unsigned
                    v = (static_cast<int32_t>(s[0]) - 128) << 8;
                    break;
                case 16:
                    v = static_cast<int16_t>(read_le16(s));
                    break;
                case 24: {
                    int32_t raw = static_cast<int32_t>(s[0]) |
                                  (static_cast<int32_t>(s[1]) << 8) |
                                  (static_cast<int32_t>(s[2]) << 16);
                    if (raw & 0x800000) raw |= ~0xFFFFFF; // sign-extend
                    v = raw >> 8;
                    break;
                }
                case 32:
                    v = static_cast<int32_t>(read_le32(s) >> 16); // keep high 16 bits
                    break;
                default:
                    error = "Unsupported WAV bit depth.";
                    return false;
            }
        }
        interleaved[i] = static_cast<int16_t>(
            std::max<int64_t>(-32768, std::min<int64_t>(32767, v)));
    }

    pcm.sample_rate = sample_rate;
    if (!append_mono_pcm(pcm, interleaved.data(), interleaved.size(), channels)) {
        error = "AUDIO_TOO_LONG";
        return false;
    }
    if (!resample_mono(pcm.samples, pcm.sample_rate, kRecorderSampleRate)) {
        error = "Failed to resample WAV to " + std::to_string(kRecorderSampleRate) + " Hz.";
        return false;
    }
    pcm.sample_rate = kRecorderSampleRate;
    return true;
}

static bool decode_wav_to_mono_pcm(const std::string& input_path,
                                   MonoPcm& pcm, std::string& error) {
    std::ifstream file(input_path, std::ios::binary | std::ios::ate);
    if (!file) {
        error = "Cannot open audio file.";
        return false;
    }
    const std::streampos end = file.tellg();
    if (end < 0) {
        error = "Cannot stat audio file.";
        return false;
    }
    file.seekg(0);
    std::vector<uint8_t> buf(static_cast<size_t>(end));
    if (!buf.empty() && !file.read(reinterpret_cast<char*>(buf.data()),
                                   static_cast<std::streamsize>(buf.size()))) {
        error = "Cannot read audio file.";
        return false;
    }
    return parse_wav_mono_pcm(buf.data(), buf.size(), pcm, error);
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
// entry point (transcode to Ogg, decode to WAV, waveform analysis), so
// duration and waveform can never be derived from a different
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

    if (is_ogg_vorbis(input_path)) {
        return decode_vorbis_to_mono_pcm(input_path, pcm, error);
    }

    // WAV is the only non-Ogg container this module decodes itself. Any other
    // source (MP3/AAC/M4A/AMR/3GP/WebM) is decoded by the platform and fed back
    // in through the PCM entry points, so signal that rather than a hard fail.
    if (decode_wav_to_mono_pcm(input_path, pcm, error)) {
        return true;
    }
    if (error == "NOT_WAV") {
        error = "PLATFORM_DECODE_REQUIRED";
    }
    return false;
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

AudioContainer classify_audio_container(const std::string& input_path) {
    switch (classify_ogg(input_path)) {
        case kOggOpus: return AudioContainer::kOggOpus;
        case kOggVorbis: return AudioContainer::kOggVorbis;
        case kOggOther: return AudioContainer::kOggOther;
        case kNotOgg:
        default: return AudioContainer::kNotOgg;
    }
}

// Writes a fan-out result's shared duration + waveform onto both halves that
// succeeded. Kept in one place so the two codecs can never report different
// numbers for the same source.
static void stamp_dual_results(DualTranscodeResult& result,
                               int duration_ms,
                               const std::vector<float>& waveform) {
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
}

DualTranscodeResult encode_pcm_to_dual(const int16_t* pcm_data, size_t num_samples,
                                       uint32_t sample_rate, uint16_t channels,
                                       const std::string& opus_output_path,
                                       const std::string& vorbis_output_path) {
    DualTranscodeResult result;

    std::vector<int16_t> mono;
    if (!normalize_pcm_to_contract(pcm_data, num_samples, channels, sample_rate,
                                   mono, result.opus.error_message)) {
        result.vorbis.error_message = result.opus.error_message;
        return result;
    }

    if (!encode_opus(mono, kRecorderSampleRate, kTargetChannels, opus_output_path, 20)) {
        result.opus.error_message = "Failed to encode Ogg Opus output.";
    }

    if (vorbis_output_path.empty()) {
        // Caller did not ask for a Vorbis copy (e.g. > Wit cap): report the
        // half as skipped rather than as a real failure.
        result.vorbis.error_message = "SKIPPED";
    } else if (!encode_vorbis(mono, kRecorderSampleRate, kTargetChannels,
                              vorbis_output_path)) {
        result.vorbis.error_message = "Failed to encode Vorbis output.";
    }

    stamp_dual_results(result, pcm_duration_ms(mono.size(), kRecorderSampleRate),
                       compute_waveform(mono));
    return result;
}

DecodeResult resolve_ogg_to_artifacts(const std::string& input_path,
                                      const std::string& opus_output_path,
                                      const std::string& vorbis_output_path,
                                      const std::string& wav_output_path,
                                      size_t max_audio_bytes) {
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

    if (!opus_output_path.empty()) {
        if (pcm.source_is_reusable) {
            if (!copy_file(input_path, opus_output_path)) {
                result.error_message = "Failed to reuse existing Ogg Opus source.";
                return result;
            }
        } else if (!encode_opus(pcm.samples, pcm.sample_rate, kTargetChannels,
                                opus_output_path, 20)) {
            result.error_message = "Failed to encode Ogg Opus output.";
            return result;
        }
    }

    if (!vorbis_output_path.empty() &&
        !encode_vorbis(pcm.samples, pcm.sample_rate, kTargetChannels, vorbis_output_path)) {
        result.error_message = "Failed to encode Vorbis output.";
        return result;
    }

    // A 16 kHz mono WAV gives the platform a source it can decode for the M4A
    // playback artifact; the platform deletes it once the encode is done.
    if (!wav_output_path.empty() &&
        !write_wav(pcm.samples, pcm.sample_rate, kTargetChannels, wav_output_path)) {
        result.error_message = "Failed to write WAV bridge output.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);
    result.success = true;
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

    if (!write_wav(pcm.samples, pcm.sample_rate, kTargetChannels, output_path)) {
        result.error_message = "Failed to write WAV output.";
        return result;
    }

    result.duration_ms = pcm_duration_ms(pcm.samples.size(), pcm.sample_rate);
    result.waveform = compute_waveform(pcm.samples);

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
    // fail. Classify by the first page's codec id so only genuine Opus
    // streams take the libopusfile path; WAV is parsed locally and every
    // other format is handed to the platform decoder.
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
        // Non-Ogg, non-Opus memory buffers (MP3/AAC/M4A/…) are decoded by the
        // platform; only WAV can be parsed here.
        if (!parse_wav_mono_pcm(data, data_size, pcm, result.error_message)) {
            if (result.error_message == "NOT_WAV") {
                result.error_message = "PLATFORM_DECODE_REQUIRED";
            }
            return result;
        }
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

// Reads only the WAV chunk table (skipping sample data) to compute duration
// without decoding. -1 when the file is not a parseable WAV.
static int wav_duration_ms_from_header(const std::string& input_path) {
    std::ifstream file(input_path, std::ios::binary | std::ios::ate);
    if (!file) return -1;
    const std::streampos end = file.tellg();
    if (end < 12) return -1;
    const size_t size = static_cast<size_t>(end);

    file.seekg(0);
    uint8_t riff[12];
    if (!file.read(reinterpret_cast<char*>(riff), 12)) return -1;
    if (std::memcmp(riff, "RIFF", 4) != 0 || std::memcmp(riff + 8, "WAVE", 4) != 0) {
        return -1;
    }

    uint32_t sample_rate = 0;
    uint16_t channels = 0;
    uint16_t bits = 0;
    uint64_t data_size = 0;
    bool have_fmt = false;

    std::streampos pos = 12;
    while (static_cast<std::streamoff>(pos) + 8 <= static_cast<std::streamoff>(size)) {
        file.seekg(pos);
        uint8_t chunk[8];
        if (!file.read(reinterpret_cast<char*>(chunk), 8)) break;
        const uint32_t chunk_size = read_le32(chunk + 4);
        if (std::memcmp(chunk, "fmt ", 4) == 0 && chunk_size >= 16) {
            uint8_t fmt[16];
            if (!file.read(reinterpret_cast<char*>(fmt), 16)) break;
            channels = read_le16(fmt + 2);
            sample_rate = read_le32(fmt + 4);
            bits = read_le16(fmt + 14);
            have_fmt = true;
        } else if (std::memcmp(chunk, "data", 4) == 0) {
            data_size = chunk_size;
        }
        pos += static_cast<std::streampos>(8 + chunk_size + (chunk_size & 1u));
    }

    const size_t frame_bytes = (bits / 8) * channels;
    if (!have_fmt || data_size == 0 || frame_bytes == 0 || sample_rate == 0) {
        return -1;
    }
    return static_cast<int>((data_size / frame_bytes) * 1000 / sample_rate);
}

// Duration of an audio file without a full decode; -1 when unknown. Used by
// the share flows to gate against the plan's limit on the *original* file
// before any decode work.
int probe_audio_duration_ms(const std::string& input_path) {
    const OggStreamKind kind = classify_ogg(input_path);

    if (kind == kOggOpus) {
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

    if (kind == kOggVorbis) {
        OggVorbis_File vf;
        if (ov_fopen(input_path.c_str(), &vf) != 0) return -1;
        vorbis_info* info = ov_info(&vf, -1);
        const ogg_int64_t frames = ov_pcm_total(&vf, -1);
        const long rate = info != nullptr ? info->rate : 0;
        ov_clear(&vf);
        if (frames <= 0 || rate <= 0) return -1;
        return static_cast<int>(frames * 1000 / rate);
    }

    if (kind == kNotOgg) {
        return wav_duration_ms_from_header(input_path);
    }

    return -1;
}

} // namespace ekwe
