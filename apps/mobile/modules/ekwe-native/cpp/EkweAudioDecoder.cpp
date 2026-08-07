#include "EkweAudioDecoder.h"
#include "EkweOpusEncoder.h"
#include "EkweOggMuxer.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>

#define MINIAUDIO_IMPLEMENTATION
#include "thirdparty/miniaudio.h"

#include "thirdparty/opusfile/include/opusfile.h"

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
        float bin_max = 0.0f;

        for (int j = start_idx; j < end_idx; ++j) {
            float val = std::abs((float)pcm_data[j] / 32768.0f);
            if (val > bin_max) bin_max = val;
        }

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

    if (!muxer.write_opus_header(channels, encoder.lookahead(), sample_rate)) return false;
    if (!muxer.write_opus_comment()) return false;

    size_t frame_size = sample_rate / 50;
    size_t total_samples = pcm_data.size();
    // RFC 7845 requires Ogg granule positions to always be expressed in units
    // of 48 kHz samples, regardless of the Opus encoder's input sample rate.
    // Advances by (this_frame * kOpusGranuleRate / sample_rate) so the
    // player-reported duration matches the true decoded length — without this,
    // a 16 kHz re-encode under-reports duration and playback appears to run
    // "past the end" of the waveform. (Pre-skip/lookahead is handled by the
    // muxer header, so granule advancement just tracks elapsed output.)
    int64_t granule_position = 0;

    for (size_t offset = 0; offset < total_samples; offset += frame_size * channels) {
        size_t remaining_frames = (total_samples - offset) / channels;
        size_t this_frame = std::min(frame_size, remaining_frames);

        std::vector<uint8_t> packet;
        if (!encoder.encode_frame(pcm_data.data() + offset, this_frame * channels, packet)) {
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
