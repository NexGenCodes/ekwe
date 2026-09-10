#include "EkweAudioDecoder.h"
#include "EkweOpusEncoder.h"
#include "EkweOggMuxer.h"
#include "EkweCafMuxer.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>
#include <cstdio>

#define MINIAUDIO_IMPLEMENTATION
#include "thirdparty/miniaudio.h"

#include "thirdparty/opusfile/include/opusfile.h"
#include <ogg/ogg.h>

namespace ekwe {

static bool is_ogg_opus(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return false;
    char header[4];
    if (file.read(header, 4)) {
        return (header[0] == 'O' && header[1] == 'g' && header[2] == 'g' && header[3] == 'S');
    }
    return false;
}

static bool file_size(const std::string& path, uint64_t& out_size) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return false;
    std::streampos end = file.tellg();
    if (end < 0) return false;
    out_size = static_cast<uint64_t>(end);
    return true;
}

// Appends decoded mono samples to `out`, refusing to exceed the hard cap so a
// pathological source cannot exhaust memory. Returns false when the cap is hit.
static bool append_samples(std::vector<int16_t>& out,
                           const int16_t* data, size_t count) {
    if (out.size() + count > kMaxDecodedSamples) return false;
    out.insert(out.end(), data, data + count);
    return true;
}

static bool append_samples(std::vector<int16_t>& out,
                           const std::vector<int16_t>& chunk) {
    return append_samples(out, chunk.data(), chunk.size());
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

static std::vector<float> compute_waveform(const std::vector<int16_t>& pcm_data) {
    std::vector<float> waveform;
    if (pcm_data.empty()) return waveform;

    int num_bins = 60;
    int samples_per_bin = pcm_data.size() / num_bins;
    if (samples_per_bin == 0) {
        samples_per_bin = 1;
        num_bins = pcm_data.size();
    }

    waveform.reserve(num_bins);
    float max_val = 0.0f;

    for (int i = 0; i < num_bins; ++i) {
        int start_idx = i * samples_per_bin;
        int end_idx = std::min((int)pcm_data.size(), (i + 1) * samples_per_bin);
        int16_t bin_max_int = 0;
        for (int j = start_idx; j < end_idx; ++j) {
            // std::abs promotes int16_t to int, so -32768 safely becomes 32768, 
            // which exceeds int16_t max (32767). We cap it back to 32767 for uint cast
            // or just use int for the max tracking to avoid UB.
            int val = std::abs(static_cast<int>(pcm_data[j]));
            if (val > bin_max_int) bin_max_int = static_cast<int16_t>(std::min(val, 32767));
        }

        float bin_max = (float)bin_max_int / 32768.0f;

        waveform.push_back(bin_max);
        if (bin_max > max_val) max_val = bin_max;
    }

    const float NOISE_FLOOR = 0.02f;
    if (max_val > 0.0f) {
        float divisor = std::max(max_val, NOISE_FLOOR);
        for (float& val : waveform) {
            val = std::min(1.0f, val / divisor);
        }
    }

    return waveform;
}

static bool encode_opus(const std::vector<int16_t>& pcm_data, uint32_t sample_rate,
                        uint16_t channels, const std::string& output_path) {
    OpusStreamEncoder encoder(sample_rate, channels, 5);
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

    size_t frame_size = sample_rate / 50;
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

DecodeResult transcode_audio_to_opus(const std::string& input_path, const std::string& output_path,
                                     size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;

    // Reject oversized inputs before any decoding work. This is the single
    // chokepoint guarding the file-based path on both Android and iOS.
    // A non-positive limit (e.g. a caller bug) would otherwise reject everything
    // below the true cap, so fall back to the shared default in that case.
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

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;
    bool reuse_source = false;

    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000;
        out_channels = 1;

        // The source is already the exact target we would encode (16 kHz mono),
        // so we can reuse it verbatim instead of decoding → re-encoding.
        const OpusHead* head = op_head(of, -1);
        reuse_source = (head != nullptr) &&
                       (head->input_sample_rate == 16000) &&
                       (head->channel_count == 1);

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read < 0) break;
            if (samples_read == 0) break;
            if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(samples_read))) {
                op_free(of);
                result.error_message = "AUDIO_TOO_LONG";
                return result;
            }
        }

        op_free(of);
    } else {
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio failed to initialize decoder: " + std::to_string(ma_res);
            return result;
        }

        out_sample_rate = decoder.outputSampleRate;
        out_channels = decoder.outputChannels;

        ma_uint64 total_frames = 0;
        ma_decoder_get_length_in_pcm_frames(&decoder, &total_frames);
        if (total_frames > 0) {
            pcm_data.reserve(std::min<ma_uint64>(total_frames * out_channels, kMaxDecodedSamples));
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * out_channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(frames_read * out_channels))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    if (reuse_source) {
        // No transcode: the input is already 16 kHz mono Ogg Opus. Copy it as-is
        // (cheap) while still extracting duration + waveform from the decoded PCM.
        if (!copy_file(input_path, output_path)) {
            result.error_message = "Failed to reuse existing Ogg Opus source.";
            return result;
        }
    } else {
        if (!encode_opus(pcm_data, out_sample_rate, out_channels, output_path)) {
            result.error_message = "Failed to encode Ogg Opus output.";
            return result;
        }
    }

    result.duration_ms = (pcm_data.size() / out_channels) * 1000 / out_sample_rate;
    result.waveform = compute_waveform(pcm_data);

    result.success = true;
    return result;
}

// ─── Decode → WAV (for players without Ogg Opus support, e.g. AVPlayer) ───

DecodeResult decode_audio_to_wav(const std::string& input_path, const std::string& output_path,
                                 size_t max_audio_bytes) {
    DecodeResult result;
    result.success = false;

    // Same size chokepoint as transcode_audio_to_opus: never decode anything
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

    std::vector<int16_t> pcm_data;
    uint32_t sample_rate = 16000;
    uint16_t channels = 1;

    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        sample_rate = 48000;
        channels = 1;

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read <= 0) break;
            if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(samples_read))) {
                op_free(of);
                result.error_message = "AUDIO_TOO_LONG";
                return result;
            }
        }

        op_free(of);
    } else {
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio failed to initialize decoder: " + std::to_string(ma_res);
            return result;
        }

        sample_rate = decoder.outputSampleRate;
        channels = decoder.outputChannels;

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(frames_read * channels))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    if (!write_wav(pcm_data, sample_rate, channels, output_path)) {
        result.error_message = "Failed to write WAV output.";
        return result;
    }

    result.duration_ms = (pcm_data.size() / channels) * 1000 / sample_rate;
    result.waveform = compute_waveform(pcm_data);

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
    OpusStreamEncoder encoder(sample_rate, channels, 5);
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

DecodeResult decode_audio_to_caf(const std::string& input_path, const std::string& output_path,
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
        std::vector<int16_t> pcm_data;
        uint32_t sample_rate = 16000;
        uint16_t channels = 1;

        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_file(input_path.c_str(), &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio failed to initialize decoder: " + std::to_string(ma_res);
            return result;
        }

        sample_rate = decoder.outputSampleRate;
        channels = decoder.outputChannels;

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(frames_read * channels))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);

        if (pcm_data.empty()) {
            result.error_message = "Decoded audio is empty.";
            return result;
        }

        if (!encode_pcm_to_caf(pcm_data, sample_rate, channels, output_path, result.error_message)) {
            return result;
        }

        result.duration_ms = (pcm_data.size() / channels) * 1000 / sample_rate;
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
    const uint8_t* data, size_t data_size, const std::string& output_path, size_t max_audio_bytes) {
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

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;
    bool reuse_source = false;

    bool is_opus = (data_size >= 4 &&
                    data[0] == 'O' && data[1] == 'g' &&
                    data[2] == 'g' && data[3] == 'S');

    if (is_opus) {
        MemStream ms = { data, data_size, 0 };
        OpusFileCallbacks callbacks = { mem_read, mem_seek, mem_tell, mem_close };

        int err = 0;
        OggOpusFile* of = op_open_callbacks(&ms, &callbacks, nullptr, 0, &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus from memory. Error: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000;
        out_channels = 1;

        // Source is already the exact target (16 kHz mono): reuse bytes verbatim.
        const OpusHead* head = op_head(of, -1);
        reuse_source = (head != nullptr) &&
                       (head->input_sample_rate == 16000) &&
                       (head->channel_count == 1);

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read <= 0) break;
            if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(samples_read))) {
                op_free(of);
                result.error_message = "AUDIO_TOO_LONG";
                return result;
            }
        }

        op_free(of);
    } else {
        ma_decoder decoder;
        ma_decoder_config config = ma_decoder_config_init(ma_format_s16, 1, 16000);

        ma_result ma_res = ma_decoder_init_memory(data, data_size, &config, &decoder);
        if (ma_res != MA_SUCCESS) {
            result.error_message = "miniaudio memory decoder failed: " + std::to_string(ma_res);
            return result;
        }

        out_sample_rate = decoder.outputSampleRate;
        out_channels = decoder.outputChannels;

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * out_channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                if (!append_samples(pcm_data, buffer.data(), static_cast<size_t>(frames_read * out_channels))) {
                    ma_decoder_uninit(&decoder);
                    result.error_message = "AUDIO_TOO_LONG";
                    return result;
                }
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio from memory is empty.";
        return result;
    }

    if (reuse_source) {
        // No transcode: source bytes are already 16 kHz mono Ogg Opus.
        if (!write_bytes(data, data_size, output_path)) {
            result.error_message = "Failed to reuse existing Ogg Opus source.";
            return result;
        }
    } else {
        if (!encode_opus(pcm_data, out_sample_rate, out_channels, output_path)) {
            result.error_message = "Failed to encode Ogg Opus from memory-decoded audio.";
            return result;
        }
    }

    result.duration_ms = (pcm_data.size() / out_channels) * 1000 / out_sample_rate;
    result.waveform = compute_waveform(pcm_data);
    result.success = true;
    return result;
}

DecodeResult encode_pcm_to_opus(const int16_t* pcm_data, size_t num_samples,
                                uint32_t sample_rate, uint16_t channels,
                                const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    if (pcm_data == nullptr || num_samples == 0) {
        result.error_message = "PCM data is null or empty.";
        return result;
    }

    std::vector<int16_t> pcm_vec(pcm_data, pcm_data + num_samples);

    if (!encode_opus(pcm_vec, sample_rate, channels, output_path)) {
        result.error_message = "Failed to encode Ogg Opus from PCM data.";
        return result;
    }

    result.duration_ms = (num_samples / channels) * 1000 / sample_rate;
    result.waveform = compute_waveform(pcm_vec);

    result.success = true;
    return result;
}

} // namespace ekwe
