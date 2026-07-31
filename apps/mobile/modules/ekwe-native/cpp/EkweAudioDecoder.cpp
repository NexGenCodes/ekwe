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
    int64_t granule_position = 0;

    for (size_t offset = 0; offset < total_samples; offset += frame_size * channels) {
        size_t remaining_frames = (total_samples - offset) / channels;
        size_t this_frame = std::min(frame_size, remaining_frames);

        std::vector<uint8_t> packet;
        if (!encoder.encode_frame(pcm_data.data() + offset, this_frame * channels, packet)) {
            return false;
        }

        granule_position += static_cast<int64_t>(this_frame);
        if (!muxer.write_packet(packet.data(), packet.size(), granule_position)) {
            return false;
        }
    }

    muxer.finalize();
    return true;
}

DecodeResult extract_audio_and_waveform(const std::string& input_path, const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;

    if (is_ogg_opus(input_path)) {
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000;
        out_channels = 1;

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read < 0) break;
            if (samples_read == 0) break;
            pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + samples_read);
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
            pcm_data.reserve(total_frames * out_channels);
        }

        const int CHUNK_SIZE = 4096;
        std::vector<int16_t> buffer(CHUNK_SIZE * out_channels);
        ma_uint64 frames_read = 0;

        while (true) {
            ma_res = ma_decoder_read_pcm_frames(&decoder, buffer.data(), CHUNK_SIZE, &frames_read);
            if (frames_read > 0) {
                pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + frames_read * out_channels);
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio is empty.";
        return result;
    }

    if (!encode_opus(pcm_data, out_sample_rate, out_channels, output_path)) {
        result.error_message = "Failed to encode Ogg Opus output.";
        return result;
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

DecodeResult extract_audio_and_waveform_from_memory(
    const uint8_t* data, size_t data_size, const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    if (!data || data_size == 0) {
        result.error_message = "Input data is null or empty.";
        return result;
    }

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;

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

        const int MAX_FRAME_SIZE = 9600;
        std::vector<int16_t> buffer(MAX_FRAME_SIZE);

        while (true) {
            int samples_read = op_read(of, (opus_int16*)buffer.data(), buffer.size(), nullptr);
            if (samples_read <= 0) break;
            pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + samples_read);
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
                pcm_data.insert(pcm_data.end(), buffer.begin(), buffer.begin() + frames_read * out_channels);
            }
            if (frames_read < CHUNK_SIZE || ma_res != MA_SUCCESS) break;
        }

        ma_decoder_uninit(&decoder);
    }

    if (pcm_data.empty()) {
        result.error_message = "Decoded audio from memory is empty.";
        return result;
    }

    if (!encode_opus(pcm_data, out_sample_rate, out_channels, output_path)) {
        result.error_message = "Failed to encode Ogg Opus from memory-decoded audio.";
        return result;
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
