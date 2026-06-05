#include "EkweAudioDecoder.h"

#include <iostream>
#include <fstream>
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdint>

#define MINIAUDIO_IMPLEMENTATION
#include "thirdparty/miniaudio.h"

// For Opus decoding
#include "thirdparty/opusfile/include/opusfile.h"

// For FLAC encoding
#include "FLAC/stream_encoder.h"

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

// Extract max amplitude for 60 bins
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

    // Normalize — but apply a noise floor so quiet recordings
    // don't get stretched to full height (the "flat block" bug).
    // If the peak is below 2% of full scale, cap the divisor
    // so the waveform stays proportionally small.
    const float NOISE_FLOOR = 0.02f;
    if (max_val > 0.0f) {
        float divisor = std::max(max_val, NOISE_FLOOR);
        for (float& val : waveform) {
            val = std::min(1.0f, val / divisor);
        }
    }

    return waveform;
}

static bool encode_flac(const std::vector<int16_t>& pcm_data, uint32_t sample_rate,
                        uint16_t channels, const std::string& output_path) {
    FLAC__StreamEncoder* encoder = FLAC__stream_encoder_new();
    if (!encoder) return false;

    FLAC__stream_encoder_set_channels(encoder, channels);
    FLAC__stream_encoder_set_bits_per_sample(encoder, 16);
    FLAC__stream_encoder_set_sample_rate(encoder, sample_rate);
    FLAC__stream_encoder_set_compression_level(encoder, 5); // Good balance of speed vs compression
    FLAC__stream_encoder_set_verify(encoder, false); // Skip verify for speed on mobile

    FLAC__StreamEncoderInitStatus init_status =
        FLAC__stream_encoder_init_file(encoder, output_path.c_str(), nullptr, nullptr);

    if (init_status != FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
        FLAC__stream_encoder_delete(encoder);
        return false;
    }

    // FLAC encoder expects FLAC__int32 samples, not int16_t
    // Process in chunks to avoid massive memory allocation
    const size_t CHUNK_FRAMES = 4096;
    const size_t total_samples = pcm_data.size();
    const size_t total_frames = total_samples / channels;
    std::vector<FLAC__int32> buffer(CHUNK_FRAMES * channels);

    size_t frames_processed = 0;
    bool ok = true;

    while (frames_processed < total_frames) {
        size_t frames_this_chunk = std::min(CHUNK_FRAMES, total_frames - frames_processed);
        size_t sample_offset = frames_processed * channels;

        for (size_t i = 0; i < frames_this_chunk * channels; ++i) {
            buffer[i] = (FLAC__int32)pcm_data[sample_offset + i];
        }

        if (!FLAC__stream_encoder_process_interleaved(encoder, buffer.data(), frames_this_chunk)) {
            ok = false;
            break;
        }
        frames_processed += frames_this_chunk;
    }

    FLAC__stream_encoder_finish(encoder);
    FLAC__stream_encoder_delete(encoder);
    return ok;
}

DecodeResult extract_audio_and_waveform(const std::string& input_path, const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    std::vector<int16_t> pcm_data;
    uint32_t out_sample_rate = 16000;
    uint16_t out_channels = 1;

    if (is_ogg_opus(input_path)) {
        // Decode using libopusfile
        int err = 0;
        OggOpusFile* of = op_open_file(input_path.c_str(), &err);
        if (of == nullptr) {
            result.error_message = "Failed to open Opus file. Error code: " + std::to_string(err);
            return result;
        }

        out_sample_rate = 48000; // opusfile decodes to 48kHz
        out_channels = 1; // Force mono

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
        // Decode using miniaudio (handles WAV, MP3, M4A, AAC, FLAC, WMA, etc.)
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

    // Encode to FLAC
    if (!encode_flac(pcm_data, out_sample_rate, out_channels, output_path)) {
        result.error_message = "Failed to encode FLAC output.";
        return result;
    }

    // Calculate duration in ms
    result.duration_ms = (pcm_data.size() / out_channels) * 1000 / out_sample_rate;

    // Compute waveform
    result.waveform = compute_waveform(pcm_data);

    result.success = true;
    return result;
}

DecodeResult encode_pcm_to_flac(const int16_t* pcm_data, size_t num_samples,
                                uint32_t sample_rate, uint16_t channels,
                                const std::string& output_path) {
    DecodeResult result;
    result.success = false;

    if (pcm_data == nullptr || num_samples == 0) {
        result.error_message = "PCM data is null or empty.";
        return result;
    }

    // Wrap raw pointer in a vector for reuse of existing helpers
    std::vector<int16_t> pcm_vec(pcm_data, pcm_data + num_samples);

    // Encode to FLAC
    if (!encode_flac(pcm_vec, sample_rate, channels, output_path)) {
        result.error_message = "Failed to encode FLAC from PCM data.";
        return result;
    }

    // Calculate duration
    result.duration_ms = (num_samples / channels) * 1000 / sample_rate;

    // Compute waveform
    result.waveform = compute_waveform(pcm_vec);

    result.success = true;
    return result;
}

} // namespace ekwe
